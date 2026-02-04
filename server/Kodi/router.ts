/**
 * Kodi Addon Router
 * Provides token-based authentication and media streaming for the Kodi addon
 */

import fs from 'fs'
import fsPromises from 'node:fs/promises'
import path from 'path'
import KoaRouter from '@koa/router'
import jsonWebToken from 'jsonwebtoken'
import getLogger from '../lib/Log.js'
import { getExt } from '../lib/util.js'
import Media from '../Media/Media.js'
import Prefs from '../Prefs/Prefs.js'
import Rooms from '../Rooms/Rooms.js'
import User from '../User/User.js'
import fileTypes from '../Media/fileTypes.js'

interface RequestWithBody {
  body: Record<string, any>
}

const log = getLogger('Kodi')
const router = new KoaRouter({ prefix: '/api/kodi' })
const { sign: jwtSign, verify: jwtVerify } = jsonWebToken

/**
 * POST /api/kodi/token
 * Generate a JWT token for Kodi addon authentication
 * This is the only public endpoint - returns a token for subsequent requests
 */
router.post('/token', async (ctx) => {
  const req = ctx.request as unknown as RequestWithBody
  const { roomId, roomPassword } = req.body as { roomId?: number; roomPassword?: string }

  if (!roomId) {
    ctx.throw(400, 'roomId is required')
  }

  // Validate room exists and password is correct (if room has password)
  try {
    await Rooms.validate(roomId, roomPassword || '', {
      isOpen: true,
      validatePassword: true,
    })
  } catch (err) {
    ctx.throw(401, err.message)
  }

  // Create Kodi addon user context
  const kodiUserCtx = {
    userId: -1, // Virtual user ID for Kodi
    name: 'Kodi Addon',
    isAdmin: false,
    isGuest: false,
    isKodiAddon: true,
    roomId: roomId,
    dateCreated: Math.floor(Date.now() / 1000),
    dateUpdated: Math.floor(Date.now() / 1000),
  }

  // Create JWT (valid for 24 hours)
  const token = jwtSign(kodiUserCtx, ctx.jwtKey, { expiresIn: '24h' })

  log.info('Token generated for Kodi addon (room %s)', roomId)

  ctx.body = {
    token,
    expiresIn: 86400, // 24 hours in seconds
    user: kodiUserCtx,
  }
})

/**
 * Middleware to verify Bearer token for protected routes
 */
const verifyKodiToken = async (ctx, next) => {
  const authHeader = ctx.headers.authorization

  log.verbose('Kodi auth header: %s', authHeader ? authHeader.substring(0, 50) + '...' : 'none')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    log.warn('Missing or invalid Authorization header')
    ctx.throw(401, 'Authorization header required')
  }

  const token = authHeader.substring(7)

  try {
    ctx.kodiUser = jwtVerify(token, ctx.jwtKey)

    // Verify it's actually a Kodi addon token
    if (!ctx.kodiUser.isKodiAddon) {
      ctx.throw(401, 'Invalid Kodi token')
    }
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      ctx.throw(401, 'Token expired')
    }
    ctx.throw(401, 'Invalid token')
  }

  await next()
}

/**
 * Helper to get media file info
 */
const getMediaFile = async (mediaId: number) => {
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

  return path.join(basePath, relPath)
}

/**
 * HEAD /api/kodi/stream/:mediaId
 * Return headers for media file (Kodi uses this to get file size before streaming)
 */
router.head('/stream/:mediaId', verifyKodiToken, async (ctx) => {
  const mediaId = parseInt(ctx.params.mediaId, 10)

  if (Number.isNaN(mediaId)) {
    ctx.throw(422, 'Invalid mediaId')
  }

  const file = await getMediaFile(mediaId)
  if (!file) {
    ctx.throw(404, 'Media not found')
  }

  try {
    const stats = await fsPromises.stat(file)
    const ext = getExt(file)
    const mimeType = fileTypes[ext]?.mimeType

    if (!mimeType) {
      ctx.throw(404, `Unknown file type: ${ext}`)
    }

    ctx.status = 200
    ctx.set('Content-Length', String(stats.size))
    ctx.set('Accept-Ranges', 'bytes')
    ctx.type = mimeType
    // No body for HEAD request

    log.verbose('HEAD request for Kodi (%sMB): %s', (stats.size / 1000000).toFixed(2), file)
  } catch (err) {
    log.error('HEAD error: %s', err.message)
    ctx.throw(404, 'File not found')
  }
})

/**
 * GET /api/kodi/stream/:mediaId
 * Stream media file for Kodi addon (requires Bearer token)
 * Note: koa-range middleware handles Range requests automatically
 */
router.get('/stream/:mediaId', verifyKodiToken, async (ctx) => {
  const mediaId = parseInt(ctx.params.mediaId, 10)

  if (Number.isNaN(mediaId)) {
    ctx.throw(422, 'Invalid mediaId')
  }

  const file = await getMediaFile(mediaId)
  if (!file) {
    ctx.throw(404, 'Media not found')
  }

  try {
    const stats = await fsPromises.stat(file)
    const ext = getExt(file)
    const mimeType = fileTypes[ext]?.mimeType

    if (!mimeType) {
      ctx.throw(404, `Unknown file type: ${ext}`)
    }

    // Let koa-range handle Range requests automatically
    ctx.length = stats.size
    ctx.type = mimeType
    ctx.body = fs.createReadStream(file)

    log.verbose('Streaming to Kodi (%sMB): %s', (stats.size / 1000000).toFixed(2), file)
  } catch (err) {
    log.error('Stream error: %s', err.message)
    ctx.throw(404, 'File not found')
  }
})

/**
 * GET /api/kodi/avatar/:userId
 * Get user avatar for Kodi addon (requires Bearer token)
 */
router.get('/avatar/:userId', verifyKodiToken, (ctx) => {
  const targetId = parseInt(ctx.params.userId, 10)

  if (Number.isNaN(targetId)) {
    ctx.throw(422, 'Invalid userId')
  }

  const user = User.getById(targetId)

  if (!user || !user.image) {
    ctx.throw(404, 'User image not found')
    return
  }

  ctx.type = 'image/jpeg'
  ctx.body = user.image
})

export default router
