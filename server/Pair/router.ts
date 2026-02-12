import KoaRouter from '@koa/router'
import jsonWebToken from 'jsonwebtoken'
import PairManager from './PairManager.js'
import User from '../User/User.js'
import Rooms from '../Rooms/Rooms.js'

const router = new KoaRouter({ prefix: '/api' })
const { sign: jwtSign } = jsonWebToken

// ---------------------------------------------------------------------------
// POST /api/pair/code
// Called by the TV app (unauthenticated). Generates a short pairing code
// and a pairId for polling.
// ---------------------------------------------------------------------------
router.post('/pair/code', (ctx) => {
  const { pairId, code } = PairManager.create()

  ctx.status = 200
  ctx.body = { pairId, code }
})

// ---------------------------------------------------------------------------
// POST /api/pair/confirm
// Called by the web UI (authenticated). The logged-in user enters the code
// shown on the TV to authorize the device.
// Body: { code: string, roomId?: number }
// ---------------------------------------------------------------------------
router.post('/pair/confirm', async (ctx) => {
  // must be authenticated
  if (typeof ctx.user?.userId !== 'number') {
    ctx.throw(401, 'Authentication required')
  }

  const { code, roomId: bodyRoomId } = ctx.request.body as Record<string, any>

  if (!code || typeof code !== 'string') {
    ctx.throw(400, 'Code is required')
  }

  // resolve the user from DB to get fresh data
  const user = User.getById(ctx.user.userId, true)

  if (!user) {
    return ctx.throw(401, 'User not found')
  }

  // determine roomId: prefer body, fallback to JWT
  const roomId = parseInt(bodyRoomId, 10) || ctx.user.roomId || null

  if (typeof roomId !== 'number') {
    ctx.throw(400, 'A room must be selected')
  }

  // validate the room exists and is accessible
  try {
    await Rooms.validate(roomId, undefined, {
      isOpen: user.role !== 'admin',
      validatePassword: false,
    })
  } catch (err) {
    ctx.throw(400, err.message)
  }

  // create a JWT for the TV device with this user's identity
  const userCtx = {
    dateCreated: user.dateCreated,
    dateUpdated: user.dateUpdated,
    isAdmin: user.role === 'admin',
    isGuest: user.role === 'guest',
    name: user.name,
    roomId,
    userId: user.userId,
    username: user.username,
  }

  const token = jwtSign(userCtx, ctx.jwtKey)

  const confirmed = PairManager.confirm(code, token)

  if (!confirmed) {
    ctx.throw(404, 'Invalid or expired pairing code')
  }

  ctx.status = 200
  ctx.body = { success: true }
})

// ---------------------------------------------------------------------------
// GET /api/pair/link/:code
// QR code auto-pairing. When a logged-in user opens this URL (e.g. by
// scanning a QR code on the TV), the pairing is confirmed automatically.
// Returns an HTML result page.
// ---------------------------------------------------------------------------
router.get('/pair/link/:code', async (ctx) => {
  const { code } = ctx.params

  // must be authenticated
  if (typeof ctx.user?.userId !== 'number') {
    ctx.type = 'html'
    ctx.status = 401
    ctx.body = pairResultPage(
      'Login Required',
      'Please log in to the Karaoke Eternal web app first, then scan the QR code again.',
      false,
    )
    return
  }

  const user = User.getById(ctx.user.userId, true)

  if (!user) {
    ctx.type = 'html'
    ctx.status = 401
    ctx.body = pairResultPage('User Not Found', 'Your account could not be found.', false)
    return
  }

  const roomId = ctx.user.roomId || null

  if (typeof roomId !== 'number') {
    ctx.type = 'html'
    ctx.status = 400
    ctx.body = pairResultPage('No Room Selected', 'Please select a room in the web app first.', false)
    return
  }

  try {
    await Rooms.validate(roomId, undefined, {
      isOpen: user.role !== 'admin',
      validatePassword: false,
    })
  } catch (err) {
    ctx.type = 'html'
    ctx.status = 400
    ctx.body = pairResultPage('Room Error', err.message, false)
    return
  }

  const userCtx = {
    dateCreated: user.dateCreated,
    dateUpdated: user.dateUpdated,
    isAdmin: user.role === 'admin',
    isGuest: user.role === 'guest',
    name: user.name,
    roomId,
    userId: user.userId,
    username: user.username,
  }

  const token = jwtSign(userCtx, ctx.jwtKey)
  const confirmed = PairManager.confirm(code.toUpperCase(), token)

  if (!confirmed) {
    ctx.type = 'html'
    ctx.status = 404
    ctx.body = pairResultPage(
      'Code Expired',
      'This pairing code is invalid or has expired. Please try again from the TV.',
      false,
    )
    return
  }

  ctx.type = 'html'
  ctx.status = 200
  ctx.body = pairResultPage(
    'Device Paired!',
    'The TV is now connected. You can close this page.',
    true,
  )
})

// ---------------------------------------------------------------------------
// GET /api/pair/status/:pairId
// Polled by the TV app (unauthenticated). Returns the current pairing status.
// Once confirmed, returns the JWT token and consumes the session.
// ---------------------------------------------------------------------------
router.get('/pair/status/:pairId', (ctx) => {
  const { pairId } = ctx.params
  const result = PairManager.getStatus(pairId)

  ctx.status = 200
  ctx.body = result
})

function pairResultPage (title: string, message: string, success: boolean): string {
  const color = success ? '#4CAF50' : '#F44336'
  const icon = success ? '&#10003;' : '&#10007;'

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} - Karaoke Eternal</title>
<style>
body{font-family:-apple-system,sans-serif;background:#121212;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.c{text-align:center;padding:2rem;max-width:400px}
.i{font-size:4rem;color:${color}}
h1{color:${color};margin:1rem 0 .5rem}
p{color:#aaa;line-height:1.5}
</style></head><body>
<div class="c"><div class="i">${icon}</div><h1>${title}</h1><p>${message}</p></div>
</body></html>`
}

export default router
