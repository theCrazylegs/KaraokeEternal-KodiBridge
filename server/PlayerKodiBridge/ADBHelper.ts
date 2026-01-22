/**
 * ADB Helper pour lancer Kodi à distance
 * Utilisé principalement pour Freebox Player en mode développeur
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import getLogger from '../lib/Log.js'

const execAsync = promisify(exec)
const log = getLogger('ADBHelper')

// ------------------------------------
// Types
// ------------------------------------
export interface ADBConfig {
  enabled: boolean
  host: string        // IP de la Freebox/Android TV
  port: number        // Port ADB (5555 par défaut)
  kodiPackage: string // Package Kodi (org.xbmc.kodi par défaut)
}

// ------------------------------------
// ADBHelper Class
// ------------------------------------
class ADBHelper {
  private config: ADBConfig | null = null
  private isConnected: boolean = false

  /**
   * Configure ADB
   */
  setConfig(config: ADBConfig): void {
    this.config = config
    this.isConnected = false
  }

  /**
   * Obtenir l'adresse ADB complète
   */
  private getAddress(): string {
    if (!this.config) throw new Error('ADB not configured')
    return `${this.config.host}:${this.config.port}`
  }

  /**
   * Exécuter une commande ADB
   */
  private async execADB(command: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(`adb ${command}`, {
        timeout: 10000, // 10 secondes timeout
      })
      if (stderr && !stderr.includes('daemon')) {
        log.warn('ADB stderr: %s', stderr)
      }
      return stdout.trim()
    } catch (err) {
      log.error('ADB command failed: %s', err.message)
      throw err
    }
  }

  /**
   * Se connecter au device ADB
   */
  async connect(): Promise<boolean> {
    if (!this.config?.enabled) {
      log.verbose('ADB is disabled')
      return false
    }

    try {
      const address = this.getAddress()
      log.info('Connecting to ADB at %s', address)

      const result = await this.execADB(`connect ${address}`)

      if (result.includes('connected') || result.includes('already connected')) {
        log.info('ADB connected to %s', address)
        this.isConnected = true
        return true
      }

      log.warn('ADB connection failed: %s', result)
      this.isConnected = false
      return false
    } catch (err) {
      log.error('ADB connect error: %s', err.message)
      this.isConnected = false
      return false
    }
  }

  /**
   * Se déconnecter du device ADB
   */
  async disconnect(): Promise<void> {
    if (!this.config?.enabled || !this.isConnected) return

    try {
      const address = this.getAddress()
      await this.execADB(`disconnect ${address}`)
      log.info('ADB disconnected from %s', address)
      this.isConnected = false
    } catch (err) {
      log.error('ADB disconnect error: %s', err.message)
    }
  }

  /**
   * Vérifier si Kodi est en cours d'exécution
   */
  async isKodiRunning(): Promise<boolean> {
    if (!this.config?.enabled || !this.isConnected) return false

    try {
      const result = await this.execADB(`shell pidof ${this.config.kodiPackage}`)
      return result.length > 0
    } catch {
      return false
    }
  }

  /**
   * Lancer Kodi
   */
  async launchKodi(): Promise<boolean> {
    if (!this.config?.enabled) {
      log.verbose('ADB is disabled, cannot launch Kodi')
      return false
    }

    // S'assurer qu'on est connecté
    if (!this.isConnected) {
      const connected = await this.connect()
      if (!connected) {
        log.error('Cannot launch Kodi: ADB not connected')
        return false
      }
    }

    try {
      const packageName = this.config.kodiPackage
      log.info('Launching Kodi via ADB (%s)', packageName)

      // Lancer Kodi avec am start
      await this.execADB(`shell am start -n ${packageName}/.Splash`)

      log.info('Kodi launch command sent')
      return true
    } catch (err) {
      log.error('Failed to launch Kodi: %s', err.message)
      return false
    }
  }

  /**
   * Arrêter Kodi
   */
  async stopKodi(): Promise<boolean> {
    if (!this.config?.enabled || !this.isConnected) return false

    try {
      const packageName = this.config.kodiPackage
      log.info('Stopping Kodi via ADB (%s)', packageName)

      await this.execADB(`shell am force-stop ${packageName}`)

      log.info('Kodi stopped')
      return true
    } catch (err) {
      log.error('Failed to stop Kodi: %s', err.message)
      return false
    }
  }

  /**
   * Vérifier si ADB est disponible sur le système
   */
  async isADBAvailable(): Promise<boolean> {
    try {
      const result = await this.execADB('version')
      return result.includes('Android Debug Bridge')
    } catch {
      log.warn('ADB is not available on this system')
      return false
    }
  }

  /**
   * Obtenir le statut ADB
   */
  getStatus(): { enabled: boolean; connected: boolean; config: ADBConfig | null } {
    return {
      enabled: this.config?.enabled ?? false,
      connected: this.isConnected,
      config: this.config,
    }
  }
}

// Singleton instance
const adbHelper = new ADBHelper()

export default adbHelper
