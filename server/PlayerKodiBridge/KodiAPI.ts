/**
 * Kodi JSON-RPC API communication
 * Handles all communication with Kodi via HTTP JSON-RPC
 */

import getLogger from '../lib/Log.js'
const log = getLogger('KodiAPI')

// ------------------------------------
// Types
// ------------------------------------
export interface KodiConfig {
  host: string
  port: number
  username?: string
  password?: string
}

interface KodiRPCRequest {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
  id: number
}

interface KodiRPCResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

interface KodiPlayerProperties {
  time: { hours: number; minutes: number; seconds: number; milliseconds: number }
  totaltime: { hours: number; minutes: number; seconds: number; milliseconds: number }
  speed: number
  percentage: number
}

// ------------------------------------
// KodiAPI Class
// ------------------------------------
class KodiAPI {
  private config: KodiConfig
  private requestId: number = 0

  constructor(config: KodiConfig) {
    this.config = config
  }

  /**
   * Get the JSON-RPC endpoint URL
   */
  private getUrl(): string {
    const { host, port, username, password } = this.config
    const auth = username && password ? `${username}:${password}@` : ''
    return `http://${auth}${host}:${port}/jsonrpc`
  }

  /**
   * Send a JSON-RPC request to Kodi
   */
  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const request: KodiRPCRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: ++this.requestId,
    }

    log.verbose('Sending request: %s', method)

    try {
      const response = await fetch(this.getUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status} ${response.statusText}`)
      }

      const data: KodiRPCResponse = await response.json()

      if (data.error) {
        throw new Error(`Kodi error: ${data.error.message} (code: ${data.error.code})`)
      }

      return data.result
    } catch (err) {
      log.error('Request failed: %s - %s', method, err.message)
      throw err
    }
  }

  // ------------------------------------
  // Connection & Status
  // ------------------------------------

  /**
   * Test connection to Kodi
   */
  async ping(): Promise<boolean> {
    try {
      await this.sendRequest('JSONRPC.Ping')
      return true
    } catch {
      return false
    }
  }

  /**
   * Get Kodi version info
   */
  async getVersion(): Promise<{ major: number; minor: number; tag: string }> {
    const result = await this.sendRequest('Application.GetProperties', {
      properties: ['version'],
    }) as { version: { major: number; minor: number; tag: string } }
    return result.version
  }

  // ------------------------------------
  // Player Controls
  // ------------------------------------

  /**
   * Get active player IDs
   */
  async getActivePlayers(): Promise<Array<{ playerid: number; type: string }>> {
    const result = await this.sendRequest('Player.GetActivePlayers')
    return result as Array<{ playerid: number; type: string }>
  }

  /**
   * Get player properties (position, speed, etc.)
   */
  async getPlayerProperties(playerId: number): Promise<KodiPlayerProperties> {
    const result = await this.sendRequest('Player.GetProperties', {
      playerid: playerId,
      properties: ['time', 'totaltime', 'speed', 'percentage'],
    })
    return result as KodiPlayerProperties
  }

  /**
   * Play/Resume playback
   */
  async play(playerId: number = 1): Promise<void> {
    // Get active players first
    const players = await this.getActivePlayers()

    if (players.length === 0) {
      log.warn('No active player to play')
      return
    }

    const pid = players[0].playerid
    const props = await this.getPlayerProperties(pid)

    // Only send PlayPause if paused (speed === 0)
    if (props.speed === 0) {
      await this.sendRequest('Player.PlayPause', {
        playerid: pid,
        play: true,
      })
    }
  }

  /**
   * Pause playback
   */
  async pause(playerId: number = 1): Promise<void> {
    const players = await this.getActivePlayers()

    if (players.length === 0) {
      log.warn('No active player to pause')
      return
    }

    const pid = players[0].playerid
    const props = await this.getPlayerProperties(pid)

    // Only send PlayPause if playing (speed !== 0)
    if (props.speed !== 0) {
      await this.sendRequest('Player.PlayPause', {
        playerid: pid,
        play: false,
      })
    }
  }

  /**
   * Stop playback
   */
  async stop(playerId: number = 1): Promise<void> {
    const players = await this.getActivePlayers()

    if (players.length === 0) {
      log.warn('No active player to stop')
      return
    }

    await this.sendRequest('Player.Stop', {
      playerid: players[0].playerid,
    })
  }

  /**
   * Set volume (0-100)
   */
  async setVolume(volume: number): Promise<void> {
    const kodiVolume = Math.round(volume * 100)
    await this.sendRequest('Application.SetVolume', {
      volume: Math.min(100, Math.max(0, kodiVolume)),
    })
  }

  /**
   * Get current volume (0-100)
   */
  async getVolume(): Promise<number> {
    const result = await this.sendRequest('Application.GetProperties', {
      properties: ['volume'],
    }) as { volume: number }
    return result.volume
  }

  // ------------------------------------
  // Playlist & Media
  // ------------------------------------

  /**
   * Clear the playlist
   */
  async clearPlaylist(playlistId: number = 1): Promise<void> {
    await this.sendRequest('Playlist.Clear', {
      playlistid: playlistId,
    })
  }

  /**
   * Add a file to the playlist
   */
  async addToPlaylist(file: string, playlistId: number = 1): Promise<void> {
    await this.sendRequest('Playlist.Add', {
      playlistid: playlistId,
      item: { file },
    })
  }

  /**
   * Open/play a file directly
   */
  async openFile(file: string): Promise<void> {
    await this.sendRequest('Player.Open', {
      item: { file },
    })
    log.info('Opening file: %s', file)
  }

  /**
   * Get current playing item
   */
  async getCurrentItem(playerId?: number): Promise<{ label: string; file: string } | null> {
    const players = await this.getActivePlayers()

    if (players.length === 0) {
      return null
    }

    const pid = playerId ?? players[0].playerid
    const result = await this.sendRequest('Player.GetItem', {
      playerid: pid,
      properties: ['file'],
    }) as { item: { label: string; file: string } }

    return result.item
  }

  /**
   * Seek to position in seconds
   */
  async seek(seconds: number, playerId?: number): Promise<void> {
    const players = await this.getActivePlayers()

    if (players.length === 0) {
      log.warn('No active player to seek')
      return
    }

    const pid = playerId ?? players[0].playerid
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    const milliseconds = Math.floor((seconds % 1) * 1000)

    await this.sendRequest('Player.Seek', {
      playerid: pid,
      value: {
        time: { hours, minutes, seconds: secs, milliseconds },
      },
    })
  }

  /**
   * Convert Kodi time object to seconds
   */
  static timeToSeconds(time: { hours: number; minutes: number; seconds: number; milliseconds: number }): number {
    return time.hours * 3600 + time.minutes * 60 + time.seconds + time.milliseconds / 1000
  }

  // ------------------------------------
  // GUI / Notifications
  // ------------------------------------

  /**
   * Show a notification on Kodi
   * @param title - Notification title
   * @param message - Notification message
   * @param displayTime - Time to display in milliseconds (default 5000)
   * @param image - Optional image path (info, warning, error, or custom path)
   */
  async showNotification(
    title: string,
    message: string,
    displayTime: number = 5000,
    image: string = 'info'
  ): Promise<void> {
    await this.sendRequest('GUI.ShowNotification', {
      title,
      message,
      displaytime: displayTime,
      image,
    })
    log.verbose('Notification: %s - %s', title, message)
  }

  /**
   * Show an idle screen video in loop
   * @param videoUrl - URL or path to the video
   */
  async showIdleVideo(videoUrl: string): Promise<void> {
    // Open the video file with repeat enabled
    await this.sendRequest('Player.Open', {
      item: {
        file: videoUrl,
      },
    })
    log.info('Showing idle video: %s', videoUrl)

    // Set repeat mode to loop the video
    // Wait a bit for the player to start
    setTimeout(async () => {
      try {
        const players = await this.getActivePlayers()
        if (players.length > 0) {
          await this.sendRequest('Player.SetRepeat', {
            playerid: players[0].playerid,
            repeat: 'one',  // Repeat current video
          })
          log.verbose('Set repeat mode for idle video')
        }
      } catch (err) {
        log.verbose('Could not set repeat mode: %s', err.message)
      }
    }, 1000)
  }

  /**
   * Execute an addon
   * @param addonId - Addon ID to execute
   * @param params - Optional parameters
   */
  async executeAddon(addonId: string, params?: string): Promise<void> {
    await this.sendRequest('Addons.ExecuteAddon', {
      addonid: addonId,
      params: params || '',
    })
  }
}

export default KodiAPI
