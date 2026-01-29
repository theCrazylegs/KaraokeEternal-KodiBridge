/**
 * KodiBridge Player
 * A "headless" player that connects to KES socket.io and controls Kodi
 * Uses shared/PlayerLogic for queue management (same logic as Web Player)
 */

import path from 'path'
import Database from '../lib/Database.js'
import sql from 'sqlate'
import getLogger from '../lib/Log.js'
import Prefs from '../Prefs/Prefs.js'
import Queue from '../Queue/Queue.js'
import User from '../User/User.js'
import KodiAPI from './KodiAPI.js'
import adbHelper from './ADBHelper.js'
import {
  computeLoadNext,
  computeReplay,
  findNextUserId,
  shouldLoadNext,
  shouldReplay,
  shouldResumeFromQueueEnd,
  getCurrentQueueItem,
  getNextQueueItem,
  type PlayerStateCore,
  type QueueData,
} from '../../shared/PlayerLogic.js'

import {
  PLAYER_CMD_NEXT,
  PLAYER_CMD_OPTIONS,
  PLAYER_CMD_PAUSE,
  PLAYER_CMD_PLAY,
  PLAYER_CMD_REPLAY,
  PLAYER_CMD_VOLUME,
  PLAYER_STATUS,
  PLAYER_LEAVE,
} from '../../shared/actionTypes.js'
import { generateStreamToken } from './router.js'

const log = getLogger('KodiBridge')
const { db } = Database

// ------------------------------------
// Types
// ------------------------------------
export interface KodiBridgeConfig {
  host: string
  port: number
  username?: string
  password?: string
  enabled: boolean
  roomId: number
  // Streaming mode: 'http' (recommended) or 'file' (requires path mapping)
  streamMode?: 'http' | 'file'
  // Server URL for HTTP streaming (e.g., "http://192.168.1.10:8080")
  serverUrl?: string
  // Path mapping (only used in 'file' mode): convert paths for Kodi
  pathFrom?: string  // e.g., "F:\Music" or "/home/user/music"
  pathTo?: string    // e.g., "smb://nas/music" or "/media/nas/music"
  // ADB configuration for auto-launching Kodi (Freebox Player, Android TV)
  adb?: {
    enabled: boolean
    host?: string      // IP for ADB (defaults to Kodi host if not set)
    port: number       // ADB port (5555 by default)
    kodiPackage: string // Kodi package name (org.xbmc.kodi by default)
  }
  // Idle screen configuration (shown when no song is playing)
  idleScreen?: {
    enabled: boolean
    // URL or path to image/video to show when idle
    mediaUrl?: string
  }
}

interface MediaInfo {
  mediaId: number
  path: string
  relPath: string
  pathId: number
}

// ------------------------------------
// KodiBridge Class
// ------------------------------------
class KodiBridge {
  private io: any
  private kodi: KodiAPI | null = null
  private config: KodiBridgeConfig | null = null
  private isRunning: boolean = false
  private statusInterval: NodeJS.Timeout | null = null
  private queue: QueueData = { result: [], entities: {} }

  // Player state (mirrors Web Player state)
  private state: PlayerStateCore = {
    historyJSON: '[]',
    isAtQueueEnd: false,
    isPlaying: false,
    isVideoKeyingEnabled: false,
    mediaType: null,
    position: 0,
    queueId: -1,
    nextUserId: null,
    _isPlayingNext: false,
    _isReplayingQueueId: null,
  }

  // Additional state for KodiBridge
  private volume: number = 1
  private cdgAlpha: number = 0.5
  private cdgSize: number = 0.65
  private mp4Alpha: number = 0.5
  private playbackFailCount: number = 0  // Counter to prevent infinite loop on playback failure
  private readonly MAX_PLAYBACK_FAILURES = 3
  private lastPlayRequestTime: number = 0  // Timestamp of last play request (for grace period)
  private readonly PLAYBACK_GRACE_PERIOD = 5000  // 5 seconds grace period for Kodi to start playback
  private isWaitingForPlay: boolean = false  // In manual mode, waiting for user to press PLAY
  private notificationShown: boolean = false  // Track if we've shown the "next singer" notification (end of song)
  private preEndNotificationShown: boolean = false  // Track if we've shown the pre-end notification (15s before end)
  private readonly PRE_END_NOTIFICATION_TIME = 15  // Show notification 15 seconds before end
  private isIdleScreenShowing: boolean = false  // Track if idle screen is currently displayed
  private readonly KODI_LAUNCH_RETRY_DELAY = 5000  // Delay between Kodi launch retries
  private kodiLaunchAttempts: number = 0
  private readonly MAX_KODI_LAUNCH_ATTEMPTS = 3

  /**
   * Initialize with socket.io instance
   */
  setIO(io: any) {
    this.io = io
  }

  /**
   * Get current config from database
   */
  async getConfig(): Promise<KodiBridgeConfig | null> {
    const query = sql`
      SELECT data FROM prefs
      WHERE key = "kodiBridge"
    `
    const row = await db.get(String(query), query.parameters)

    if (row && row.data) {
      return JSON.parse(row.data) as KodiBridgeConfig
    }

    return null
  }

  /**
   * Save config to database
   */
  async setConfig(config: KodiBridgeConfig): Promise<void> {
    await Prefs.set('kodiBridge', config)
    this.config = config
  }

  /**
   * Get isAutoplayEnabled preference from database
   * Default is true (auto-advance to next song)
   */
  private async getIsAutoplayEnabled(): Promise<boolean> {
    const query = sql`
      SELECT data FROM prefs
      WHERE key = "isAutoplayEnabled"
    `
    const row = await db.get(String(query), query.parameters)

    if (row && row.data) {
      return JSON.parse(row.data) === true
    }

    // Default to true (current behavior)
    return true
  }

  /**
   * Get info about the next singer (for notifications)
   */
  private async getNextSingerInfo(): Promise<{ userName: string; songTitle: string; songArtist: string } | null> {
    const nextItem = getNextQueueItem(this.queue, this.state.queueId)
    if (!nextItem) return null

    // Get user name
    const user = await User.getById(nextItem.userId)
    if (!user) return null

    // Get song info from the database (title and artist name)
    // QueueItem only has songId, not the actual title/artist
    const query = sql`
      SELECT songs.title AS songTitle, artists.name AS artistName
      FROM songs
        INNER JOIN artists USING (artistId)
      WHERE songs.songId = ${nextItem.songId}
    `
    const songInfo = await db.get(String(query), query.parameters)

    return {
      userName: user.name,
      songTitle: songInfo?.songTitle || 'Unknown',
      songArtist: songInfo?.artistName || 'Unknown',
    }
  }

  /**
   * Show notification on Kodi for next singer (at end of song)
   */
  private async showNextSingerNotification(): Promise<void> {
    if (!this.kodi || this.notificationShown) return

    const nextInfo = await this.getNextSingerInfo()
    if (!nextInfo) {
      // No next song - show queue end notification
      await this.kodi.showNotification(
        'Queue Empty',
        'No more songs in the queue',
        5000
      )
    } else {
      // Show next singer notification
      await this.kodi.showNotification(
        `Next: ${nextInfo.userName}`,
        `${nextInfo.songArtist} - ${nextInfo.songTitle}`,
        10000  // Show for 10 seconds
      )
    }

    this.notificationShown = true
  }

  /**
   * Show pre-end notification on Kodi (15 seconds before song ends)
   * Shows an overlay with the next singer name and song title
   */
  private async showPreEndNotification(): Promise<void> {
    if (!this.kodi || this.preEndNotificationShown) return

    const nextInfo = await this.getNextSingerInfo()
    if (!nextInfo) {
      // No next song - don't show notification
      this.preEndNotificationShown = true
      return
    }

    log.verbose('Showing pre-end notification for next singer: %s', nextInfo.userName)

    // Show notification with next singer info
    await this.kodi.showNotification(
      `Up Next: ${nextInfo.userName}`,
      `${nextInfo.songArtist} - ${nextInfo.songTitle}`,
      this.PRE_END_NOTIFICATION_TIME * 1000  // Show until song ends
    )

    this.preEndNotificationShown = true
  }

  /**
   * Convert a local file path to a Kodi-compatible path
   * - Converts backslashes to forward slashes (cross-platform)
   * - Applies path mapping if configured (e.g., Windows path → SMB/NFS path)
   */
  private convertPathForKodi(filePath: string): string {
    // Step 1: Convert backslashes to forward slashes for cross-platform compatibility
    let kodiPath = filePath.replace(/\\/g, '/')

    // Step 2: Apply path mapping if configured
    if (this.config?.pathFrom && this.config?.pathTo) {
      // Normalize pathFrom for comparison (convert backslashes)
      const normalizedPathFrom = this.config.pathFrom.replace(/\\/g, '/')

      if (kodiPath.toLowerCase().startsWith(normalizedPathFrom.toLowerCase())) {
        kodiPath = this.config.pathTo + kodiPath.substring(normalizedPathFrom.length)
        log.verbose('Path mapped: %s → %s', filePath, kodiPath)
      }
    }

    return kodiPath
  }

  /**
   * Get full file path for a media item
   */
  private async getMediaPath(mediaId: number): Promise<string | null> {
    const query = sql`
      SELECT media.relPath, paths.path AS basePath
      FROM media
      INNER JOIN paths USING(pathId)
      WHERE mediaId = ${mediaId}
    `
    const row = await db.get(String(query), query.parameters)

    if (!row) {
      log.error('Media not found: %s', mediaId)
      return null
    }

    return path.join(row.basePath, row.relPath)
  }

  /**
   * Get room prefix for socket.io
   */
  private getRoomPrefix(): string {
    return `ROOM_ID_${this.config?.roomId}`
  }

  /**
   * Emit player status to room
   */
  private emitStatus(): void {
    if (!this.io || !this.config) return

    const status = {
      cdgAlpha: this.cdgAlpha,
      cdgSize: this.cdgSize,
      errorMessage: '',
      historyJSON: this.state.historyJSON,
      isAtQueueEnd: this.state.isAtQueueEnd,
      isErrored: false,
      isPlaying: this.state.isPlaying,
      isVideoKeyingEnabled: this.state.isVideoKeyingEnabled,
      isWebGLSupported: false,
      mediaType: this.state.mediaType,
      mp4Alpha: this.mp4Alpha,
      nextUserId: this.state.nextUserId,
      position: this.state.position,
      queueId: this.state.queueId,
      rgTrackGain: null,
      rgTrackPeak: null,
      volume: this.volume,
      // KodiBridge identifier
      isKodiBridge: true,
    }

    this.io.to(this.getRoomPrefix()).emit('action', {
      type: PLAYER_STATUS,
      payload: status,
    })
  }

  /**
   * Emit player leave to room
   */
  private emitLeave(): void {
    if (!this.io || !this.config) return

    this.io.to(this.getRoomPrefix()).emit('action', {
      type: PLAYER_LEAVE,
      payload: { socketId: 'kodiBridge' },
    })
  }

  /**
   * Update state and emit status
   */
  private updateState(newState: Partial<PlayerStateCore>): void {
    this.state = { ...this.state, ...newState }
    this.emitStatus()
  }

  /**
   * Refresh queue from database
   */
  async refreshQueue(): Promise<void> {
    if (!this.config) return
    this.queue = await Queue.get(this.config.roomId)
  }

  /**
   * Load and play next item in queue
   */
  private async loadNext(): Promise<void> {
    await this.refreshQueue()

    const newState = computeLoadNext(this.queue, {
      historyJSON: this.state.historyJSON,
      queueId: this.state.queueId,
    })

    this.updateState(newState)

    // If we have a next item, play it on Kodi
    if (!newState.isAtQueueEnd && newState.queueId && newState.queueId !== -1) {
      // Hide idle screen before playing
      await this.hideIdleScreen()

      const success = await this.playOnKodi(newState.queueId)

      if (success) {
        // Reset failure counter on success
        this.playbackFailCount = 0
      } else {
        // Increment failure counter
        this.playbackFailCount++
        log.warn('Playback failed (%d/%d)', this.playbackFailCount, this.MAX_PLAYBACK_FAILURES)

        if (this.playbackFailCount >= this.MAX_PLAYBACK_FAILURES) {
          log.error('Too many playback failures, stopping auto-advance')
          this.state.isPlaying = false
          this.playbackFailCount = 0
          this.emitStatus()
        }
      }
    } else if (newState.isAtQueueEnd) {
      // Queue is empty, show idle screen
      log.verbose('Queue ended, showing idle screen')
      await this.showIdleScreen()
    }
  }

  /**
   * Replay a specific queue item
   */
  private async replay(queueId: number): Promise<void> {
    await this.refreshQueue()

    const newState = computeReplay(this.queue, {
      historyJSON: this.state.historyJSON,
      queueId: this.state.queueId,
    }, queueId)

    if (newState) {
      this.updateState(newState)

      if (newState.queueId) {
        await this.playOnKodi(newState.queueId)
      }
    }
  }

  /**
   * Get the URL or path to send to Kodi for a media file
   */
  private getKodiMediaUrl(mediaId: number, filePath: string): string {
    // HTTP streaming mode (recommended)
    if (this.config?.streamMode === 'http' && this.config?.serverUrl) {
      const token = generateStreamToken(mediaId)
      const url = `${this.config.serverUrl}/api/kodi/${token}`
      log.verbose('Using HTTP streaming: %s', url)
      return url
    }

    // File mode with path mapping
    return this.convertPathForKodi(filePath)
  }

  /**
   * Play a queue item on Kodi
   */
  private async playOnKodi(queueId: number): Promise<boolean> {
    if (!this.kodi) return false

    const item = this.queue.entities[queueId]
    if (!item) {
      log.error('Queue item not found: %s', queueId)
      return false
    }

    const filePath = await this.getMediaPath(item.mediaId)
    if (!filePath) return false

    // Get the URL or path to send to Kodi
    const kodiUrl = this.getKodiMediaUrl(item.mediaId, filePath)

    try {
      log.info('Playing on Kodi: %s', kodiUrl)

      // Record timestamp for grace period (Kodi needs time to start playback)
      this.lastPlayRequestTime = Date.now()

      await this.kodi.openFile(kodiUrl)

      // Update next user
      const nextUserId = findNextUserId(this.queue, queueId, this.state.nextUserId)
      if (nextUserId !== this.state.nextUserId) {
        this.updateState({ nextUserId })
      }
      return true
    } catch (err) {
      log.error('Failed to play on Kodi: %s', err.message)
      return false
    }
  }

  /**
   * Handle player commands from socket.io
   */
  async handleCommand(type: string, payload?: any): Promise<void> {
    if (!this.isRunning || !this.kodi) return

    log.verbose('Received command: %s', type)

    switch (type) {
      case PLAYER_CMD_PLAY:
        this.state.isPlaying = true

        // If we were waiting for PLAY in manual mode, load the next song
        if (this.isWaitingForPlay) {
          log.verbose('PLAY pressed - resuming from manual pause')
          this.isWaitingForPlay = false
          this.notificationShown = false
          this.preEndNotificationShown = false
          this.state._isPlayingNext = true
          await this.loadNext()
        } else if (shouldLoadNext(this.state)) {
          await this.loadNext()
        } else {
          await this.kodi.play()
          this.emitStatus()
        }
        break

      case PLAYER_CMD_PAUSE:
        this.state.isPlaying = false
        await this.kodi.pause()
        this.emitStatus()
        break

      case PLAYER_CMD_NEXT:
        this.state._isPlayingNext = true
        await this.loadNext()
        break

      case PLAYER_CMD_REPLAY:
        if (payload?.queueId) {
          await this.replay(payload.queueId)
        }
        break

      case PLAYER_CMD_VOLUME:
        if (typeof payload === 'number') {
          this.volume = payload
          await this.kodi.setVolume(payload)
          this.emitStatus()
        }
        break

      case PLAYER_CMD_OPTIONS:
        if (payload) {
          if (typeof payload.cdgAlpha === 'number') this.cdgAlpha = payload.cdgAlpha
          if (typeof payload.cdgSize === 'number') this.cdgSize = payload.cdgSize
          if (typeof payload.mp4Alpha === 'number') this.mp4Alpha = payload.mp4Alpha
          this.emitStatus()
        }
        break
    }
  }

  /**
   * Poll Kodi for current playback status
   */
  private async pollKodiStatus(): Promise<void> {
    if (!this.kodi || !this.isRunning) return

    // If we're at the end of the queue and showing idle screen, don't do anything
    if (this.state.isAtQueueEnd && this.isIdleScreenShowing) {
      return
    }

    // If we're waiting for user to press PLAY (manual mode), just show notification
    if (this.isWaitingForPlay) {
      await this.showNextSingerNotification()
      return
    }

    try {
      const players = await this.kodi.getActivePlayers()

      if (players.length > 0) {
        const props = await this.kodi.getPlayerProperties(players[0].playerid)
        const position = KodiAPI.timeToSeconds(props.time)
        const isPlaying = props.speed !== 0

        // Check if playback ended
        const totalTime = KodiAPI.timeToSeconds(props.totaltime)

        // Check if we should show pre-end notification (15 seconds before end)
        const remainingTime = totalTime - position
        if (totalTime > this.PRE_END_NOTIFICATION_TIME && remainingTime <= this.PRE_END_NOTIFICATION_TIME && remainingTime > 1) {
          await this.showPreEndNotification()
        }

        if (totalTime > 0 && position >= totalTime - 1) {
          // Song ended - check autoplay preference
          const isAutoplayEnabled = await this.getIsAutoplayEnabled()

          if (isAutoplayEnabled) {
            // Auto mode: load next immediately
            log.verbose('Song ended, auto-loading next')
            this.state._isPlayingNext = true
            this.notificationShown = false
            this.preEndNotificationShown = false
            await this.loadNext()
          } else {
            // Manual mode: pause and wait for PLAY command
            log.verbose('Song ended, waiting for PLAY (manual mode)')
            this.state.isPlaying = false
            this.isWaitingForPlay = true
            this.notificationShown = false
            this.preEndNotificationShown = false

            // Show idle screen while waiting
            await this.showIdleScreen()

            // Show notification for next singer
            await this.showNextSingerNotification()

            this.emitStatus()
          }
          return
        }

        // Update position
        if (this.state.position !== position || this.state.isPlaying !== isPlaying) {
          this.state.position = position
          this.state.isPlaying = isPlaying
          this.emitStatus()
        }
      } else if (this.state.isPlaying && this.state.queueId !== -1 && !this.state.isAtQueueEnd && this.playbackFailCount < this.MAX_PLAYBACK_FAILURES) {
        // Check if we're still in the grace period (Kodi needs time to start playback)
        const timeSincePlayRequest = Date.now() - this.lastPlayRequestTime
        if (timeSincePlayRequest < this.PLAYBACK_GRACE_PERIOD) {
          log.verbose('No active player yet, waiting for Kodi to start (%dms remaining)', this.PLAYBACK_GRACE_PERIOD - timeSincePlayRequest)
          return
        }

        // No active player but we think we're playing - song must have ended
        const isAutoplayEnabled = await this.getIsAutoplayEnabled()

        if (isAutoplayEnabled) {
          log.verbose('No active player, auto-loading next')
          this.state._isPlayingNext = true
          this.notificationShown = false
          this.preEndNotificationShown = false
          await this.loadNext()
        } else {
          log.verbose('No active player, waiting for PLAY (manual mode)')
          this.state.isPlaying = false
          this.isWaitingForPlay = true
          this.notificationShown = false
          this.preEndNotificationShown = false
          // Show idle screen while waiting
          await this.showIdleScreen()
          await this.showNextSingerNotification()
          this.emitStatus()
        }
      }
    } catch (err) {
      log.error('Failed to poll Kodi status: %s', err.message)
    }
  }

  /**
   * Try to launch Kodi via ADB if configured
   */
  private async tryLaunchKodiViaADB(): Promise<boolean> {
    if (!this.config?.adb?.enabled) {
      return false
    }

    log.info('Attempting to launch Kodi via ADB...')

    // Configure ADB helper
    adbHelper.setConfig({
      enabled: true,
      host: this.config.adb.host || this.config.host,
      port: this.config.adb.port || 5555,
      kodiPackage: this.config.adb.kodiPackage || 'org.xbmc.kodi',
    })

    // Try to launch Kodi
    const launched = await adbHelper.launchKodi()

    if (launched) {
      log.info('Kodi launch command sent, waiting for it to start...')
      // Wait for Kodi to start (it needs time to initialize)
      await new Promise(resolve => setTimeout(resolve, 8000))
      return true
    }

    return false
  }

  /**
   * Get the idle screen URL (video)
   * Uses custom URL if configured, otherwise uses the default presentation video
   */
  private getIdleScreenUrl(): string | null {
    // If custom URL is configured, use it
    if (this.config?.idleScreen?.mediaUrl) {
      return this.config.idleScreen.mediaUrl
    }

    // Use default idle video served from the server
    if (this.config?.serverUrl) {
      return `${this.config.serverUrl}/api/kodi/idle`
    }

    return null
  }

  /**
   * Show idle screen (logo) on Kodi when no song is playing
   */
  private async showIdleScreen(): Promise<void> {
    if (!this.kodi || this.isIdleScreenShowing) return

    // Check if idle screen is enabled (enabled by default if serverUrl is configured)
    const idleScreenEnabled = this.config?.idleScreen?.enabled !== false

    if (!idleScreenEnabled) {
      // Mark as showing to prevent repeated attempts
      this.isIdleScreenShowing = true
      this.state.isPlaying = false
      this.emitStatus()
      return
    }

    const idleUrl = this.getIdleScreenUrl()
    if (!idleUrl) {
      log.verbose('No idle screen URL available (serverUrl not configured)')
      // Mark as showing to prevent repeated attempts
      this.isIdleScreenShowing = true
      this.state.isPlaying = false
      this.emitStatus()
      return
    }

    try {
      log.info('Showing idle screen on Kodi: %s', idleUrl)
      await this.kodi.showIdleVideo(idleUrl)
      this.isIdleScreenShowing = true
      this.state.isPlaying = false
      this.emitStatus()
    } catch (err) {
      log.error('Failed to show idle screen: %s', err.message)
      // Mark as showing to prevent repeated attempts even on failure
      this.isIdleScreenShowing = true
      this.state.isPlaying = false
      this.emitStatus()
    }
  }

  /**
   * Hide idle screen (stop playback)
   */
  private async hideIdleScreen(): Promise<void> {
    if (!this.kodi || !this.isIdleScreenShowing) return

    try {
      log.verbose('Hiding idle screen')
      await this.kodi.stop()
      this.isIdleScreenShowing = false
    } catch (err) {
      log.error('Failed to hide idle screen: %s', err.message)
    }
  }

  /**
   * Start the KodiBridge
   */
  async start(): Promise<boolean> {
    if (this.isRunning) {
      log.warn('KodiBridge is already running')
      return true
    }

    this.config = await this.getConfig()

    if (!this.config || !this.config.enabled) {
      log.warn('KodiBridge is not configured or not enabled')
      return false
    }

    log.info('Starting KodiBridge for room %s', this.config.roomId)
    log.info('Connecting to Kodi at %s:%s', this.config.host, this.config.port)

    // Initialize Kodi API
    this.kodi = new KodiAPI({
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      password: this.config.password,
    })

    // Test connection
    let connected = await this.kodi.ping()

    // If not connected and ADB is enabled, try to launch Kodi
    if (!connected && this.config.adb?.enabled) {
      this.kodiLaunchAttempts = 0

      while (!connected && this.kodiLaunchAttempts < this.MAX_KODI_LAUNCH_ATTEMPTS) {
        this.kodiLaunchAttempts++
        log.info('Kodi not responding, attempting to launch via ADB (attempt %d/%d)',
          this.kodiLaunchAttempts, this.MAX_KODI_LAUNCH_ATTEMPTS)

        const launched = await this.tryLaunchKodiViaADB()

        if (launched) {
          // Try to connect again
          connected = await this.kodi.ping()

          if (!connected) {
            log.warn('Kodi still not responding after launch, waiting...')
            await new Promise(resolve => setTimeout(resolve, this.KODI_LAUNCH_RETRY_DELAY))
            connected = await this.kodi.ping()
          }
        }
      }
    }

    if (!connected) {
      log.error('Failed to connect to Kodi')
      this.kodi = null
      return false
    }

    const version = await this.kodi.getVersion()
    log.info('Connected to Kodi %s.%s', version.major, version.minor)

    // Reset state
    this.state = {
      historyJSON: '[]',
      isAtQueueEnd: false,
      isPlaying: false,
      isVideoKeyingEnabled: false,
      mediaType: null,
      position: 0,
      queueId: -1,
      nextUserId: null,
      _isPlayingNext: false,
      _isReplayingQueueId: null,
    }

    // Reset additional state
    this.isWaitingForPlay = false
    this.notificationShown = false
    this.preEndNotificationShown = false
    this.playbackFailCount = 0
    this.isIdleScreenShowing = false
    this.kodiLaunchAttempts = 0

    this.isRunning = true

    // Load initial queue
    await this.refreshQueue()
    log.info('Queue loaded: %d items', this.queue.result.length)

    // Start status polling (every second)
    this.statusInterval = setInterval(() => this.pollKodiStatus(), 1000)

    // Always show idle screen on startup (until user presses PLAY)
    log.info('Showing idle screen on startup')
    await this.showIdleScreen()

    // Emit initial status
    this.emitStatus()

    log.info('KodiBridge started successfully')
    return true
  }

  /**
   * Stop the KodiBridge
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn('KodiBridge is not running')
      return
    }

    log.info('Stopping KodiBridge')

    // Stop status polling
    if (this.statusInterval) {
      clearInterval(this.statusInterval)
      this.statusInterval = null
    }

    // Hide idle screen if showing
    await this.hideIdleScreen()

    // Disconnect ADB if connected
    await adbHelper.disconnect()

    // Emit leave
    this.emitLeave()

    this.isRunning = false
    this.isIdleScreenShowing = false
    this.kodi = null

    log.info('KodiBridge stopped')
  }

  /**
   * Check if KodiBridge is running
   */
  getIsRunning(): boolean {
    return this.isRunning
  }

  /**
   * Get current status
   */
  getStatus(): { isRunning: boolean; config: KodiBridgeConfig | null } {
    return {
      isRunning: this.isRunning,
      config: this.config,
    }
  }

  /**
   * Get current player state (for /api/kodi/status endpoint)
   */
  getState(): PlayerStateCore {
    return { ...this.state }
  }
}

// Singleton instance
const kodiBridge = new KodiBridge()

export default kodiBridge
