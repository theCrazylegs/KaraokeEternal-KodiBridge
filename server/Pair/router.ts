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
    ctx.throw(401, 'User not found')
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

export default router
