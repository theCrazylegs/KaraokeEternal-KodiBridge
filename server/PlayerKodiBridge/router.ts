/**
 * KodiBridge Media Router
 * Provides HTTP streaming endpoints for Kodi to fetch media files
 * Uses temporary tokens for authentication (no JWT cookie required)
 */

import fs from 'fs'
import fsPromises from 'node:fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import KoaRouter from '@koa/router'
import getLogger from '../lib/Log.js'
import { getExt } from '../lib/util.js'
import Media from '../Media/Media.js'
import Prefs from '../Prefs/Prefs.js'
import fileTypes from '../Media/fileTypes.js'
import kodiBridge from './KodiBridge.js'
import adbHelper from './ADBHelper.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const log = getLogger('KodiBridge')
const router = new KoaRouter({ prefix: '/api/kodi' })

// Token storage: Map<token, { mediaId, expiresAt }>
const streamTokens = new Map<string, { mediaId: number; expiresAt: number }>()

// Clean up expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [token, data] of streamTokens) {
    if (data.expiresAt < now) {
      streamTokens.delete(token)
    }
  }
}, 5 * 60 * 1000)

/**
 * Generate a temporary streaming token for a media file
 * Token is valid for 10 minutes
 */
export function generateStreamToken(mediaId: number): string {
  const token = crypto.randomUUID()
  const expiresAt = Date.now() + 10 * 60 * 1000 // 10 minutes

  streamTokens.set(token, { mediaId, expiresAt })
  log.verbose('Generated stream token for mediaId %s (expires in 10min)', mediaId)

  return token
}

/**
 * Get the full streaming URL for a media file
 */
export function getStreamUrl(mediaId: number, serverUrl: string): string {
  const token = generateStreamToken(mediaId)
  return `${serverUrl}/api/kodi/${token}`
}

/**
 * Helper to get file info for a token
 */
async function getFileInfoForToken(token: string): Promise<{ file: string; stats: fs.Stats; mimeType: string } | null> {
  const tokenData = streamTokens.get(token)

  if (!tokenData) {
    log.warn('Invalid or expired stream token: %s', token)
    return null
  }

  if (tokenData.expiresAt < Date.now()) {
    streamTokens.delete(token)
    log.warn('Expired stream token: %s', token)
    return null
  }

  const { mediaId } = tokenData

  const res = await Media.search({ mediaId })
  if (!res.result.length) {
    return null
  }

  const { pathId, relPath } = res.entities[mediaId]
  const { paths } = await Prefs.get()
  const basePath = paths.entities[pathId]?.path

  if (!basePath) {
    return null
  }

  const file = path.join(basePath, relPath)

  try {
    const stats = await fsPromises.stat(file)
    const ext = getExt(file)
    const mimeType = fileTypes[ext]?.mimeType

    if (!mimeType) {
      return null
    }

    return { file, stats, mimeType }
  } catch {
    return null
  }
}

// ------------------------------------
// Status Endpoint (for Kodi plugin)
// IMPORTANT: Must be defined BEFORE /:token route to avoid being captured
// ------------------------------------

/**
 * GET /api/kodi/status
 * Returns current queue status for the Kodi plugin
 * No authentication required (public endpoint)
 */
router.get('/status', async (ctx) => {
  const status = kodiBridge.getStatus()

  if (!status.isRunning || !status.config) {
    ctx.body = {
      isRunning: false,
      nextSinger: null,
      count: 0,
      currentSinger: null,
      currentSong: null,
    }
    return
  }

  // Import Queue to get current queue data
  const Queue = (await import('../Queue/Queue.js')).default
  const { getNextQueueItem, getCurrentQueueItem } = await import('../../shared/PlayerLogic.js')

  try {
    const queue = await Queue.get(status.config.roomId)

    // Get internal state via a new method we'll need to add
    const bridgeState = kodiBridge.getState()

    // Get current item
    const currentItem = bridgeState.queueId !== -1
      ? getCurrentQueueItem(queue, bridgeState.queueId)
      : null

    // Get next item
    const nextItem = getNextQueueItem(queue, bridgeState.queueId)

    // Calculate remaining songs in queue
    const currentIndex = bridgeState.queueId !== -1
      ? queue.result.indexOf(bridgeState.queueId)
      : -1
    const remainingCount = currentIndex !== -1
      ? queue.result.length - currentIndex - 1
      : queue.result.length

    ctx.body = {
      isRunning: true,
      isPlaying: bridgeState.isPlaying,
      isAtQueueEnd: bridgeState.isAtQueueEnd,
      // Next singer info
      nextSinger: nextItem?.userDisplayName || null,
      // Current singer info
      currentSinger: currentItem?.userDisplayName || null,
      // Queue info
      count: remainingCount,
      totalInQueue: queue.result.length,
      // Current song position (for progress display)
      position: bridgeState.position,
    }
  } catch (err) {
    log.error('Error getting status: %s', err.message)
    ctx.body = {
      isRunning: true,
      nextSinger: null,
      count: 0,
      error: 'Failed to get queue status',
    }
  }
})

// ------------------------------------
// Idle Screen Video Endpoint
// IMPORTANT: Must be defined BEFORE /:token route to avoid being captured
// ------------------------------------

// Serve the idle screen video (no auth required for Kodi)
router.get('/idle', async (ctx) => {
  // The idle video is in the assets folder
  const videoPath = path.resolve(__dirname, '../../assets/presentation.mp4')

  try {
    const stats = await fsPromises.stat(videoPath)

    // Handle Range requests for video streaming
    const range = ctx.headers.range
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1
      const chunkSize = end - start + 1

      ctx.status = 206
      ctx.set('Content-Range', `bytes ${start}-${end}/${stats.size}`)
      ctx.set('Accept-Ranges', 'bytes')
      ctx.set('Content-Length', String(chunkSize))
      ctx.type = 'video/mp4'

      ctx.body = fs.createReadStream(videoPath, { start, end })
    } else {
      ctx.set('Accept-Ranges', 'bytes')
      ctx.set('Content-Length', String(stats.size))
      ctx.type = 'video/mp4'
      ctx.body = fs.createReadStream(videoPath)
    }

    log.verbose('Serving idle screen video')
  } catch (err) {
    log.error('Idle video not found at %s', videoPath)
    ctx.throw(404, 'Idle video not found')
  }
})

// HEAD request for idle video (Kodi checks before streaming)
router.head('/idle', async (ctx) => {
  const videoPath = path.resolve(__dirname, '../../assets/presentation.mp4')

  try {
    const stats = await fsPromises.stat(videoPath)
    ctx.set('Accept-Ranges', 'bytes')
    ctx.set('Content-Length', String(stats.size))
    ctx.type = 'video/mp4'
    ctx.status = 200
    log.verbose('HEAD /idle')
  } catch (err) {
    ctx.throw(404, 'Idle video not found')
  }
})

// ------------------------------------
// ADB Management Endpoints
// IMPORTANT: Must be defined BEFORE /:token route
// ------------------------------------

// Get ADB status
router.get('/adb/status', async (ctx) => {
  if (!ctx.user?.isAdmin) {
    ctx.throw(401)
    return
  }

  const status = adbHelper.getStatus()
  const isAvailable = await adbHelper.isADBAvailable()

  ctx.body = {
    ...status,
    isADBAvailable: isAvailable,
  }
})

// Test ADB connection and launch Kodi
router.post('/adb/launch', async (ctx) => {
  if (!ctx.user?.isAdmin) {
    ctx.throw(401)
    return
  }

  // Get current config
  const config = await kodiBridge.getConfig()

  if (!config?.adb?.enabled) {
    ctx.throw(400, 'ADB is not configured')
    return
  }

  // Configure ADB helper
  adbHelper.setConfig({
    enabled: true,
    host: config.adb.host || config.host,
    port: config.adb.port || 5555,
    kodiPackage: config.adb.kodiPackage || 'org.xbmc.kodi',
  })

  // Try to launch Kodi
  const success = await adbHelper.launchKodi()

  ctx.body = {
    success,
    message: success ? 'Kodi launch command sent' : 'Failed to launch Kodi',
  }
})

// Test ADB connection
router.post('/adb/connect', async (ctx) => {
  if (!ctx.user?.isAdmin) {
    ctx.throw(401)
    return
  }

  const config = await kodiBridge.getConfig()

  if (!config?.adb?.enabled) {
    ctx.throw(400, 'ADB is not configured')
    return
  }

  adbHelper.setConfig({
    enabled: true,
    host: config.adb.host || config.host,
    port: config.adb.port || 5555,
    kodiPackage: config.adb.kodiPackage || 'org.xbmc.kodi',
  })

  const success = await adbHelper.connect()

  ctx.body = {
    success,
    message: success ? 'ADB connected' : 'ADB connection failed',
  }
})

// ------------------------------------
// Media Streaming Endpoints (token-based)
// IMPORTANT: Must be LAST because /:token is a catch-all
// ------------------------------------

// Handle HEAD requests (Kodi checks file info before streaming)
router.head('/:token', async (ctx) => {
  const { token } = ctx.params
  const info = await getFileInfoForToken(token)

  if (!info) {
    ctx.throw(404, 'Media not found')
    return
  }

  ctx.set('Accept-Ranges', 'bytes')
  ctx.set('Content-Length', String(info.stats.size))
  ctx.type = info.mimeType
  ctx.status = 200

  log.verbose('HEAD %s (%sMB): %s', info.mimeType, (info.stats.size / 1000000).toFixed(2), info.file)
})

// Stream media file to Kodi (no auth required - uses temporary token)
router.get('/:token', async (ctx) => {
  const { token } = ctx.params
  const info = await getFileInfoForToken(token)

  if (!info) {
    ctx.throw(404, 'Media not found')
    return
  }

  const { file, stats, mimeType } = info

  log.verbose('Streaming %s (%sMB): %s', mimeType, (stats.size / 1000000).toFixed(2), file)

  // Handle Range requests manually (koa-range has issues with our setup)
  const range = ctx.headers.range
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1
    const chunkSize = end - start + 1

    ctx.status = 206
    ctx.set('Content-Range', `bytes ${start}-${end}/${stats.size}`)
    ctx.set('Accept-Ranges', 'bytes')
    ctx.set('Content-Length', String(chunkSize))
    ctx.type = mimeType

    ctx.body = fs.createReadStream(file, { start, end })
  } else {
    ctx.set('Accept-Ranges', 'bytes')
    ctx.set('Content-Length', String(stats.size))
    ctx.type = mimeType

    ctx.body = fs.createReadStream(file)
  }
})

export default router
