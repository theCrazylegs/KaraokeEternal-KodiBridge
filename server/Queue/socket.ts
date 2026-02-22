import Queue from './Queue.js'
import Rooms from '../Rooms/Rooms.js'
import { logQueueAction } from '../lib/queueLogger.js'
import { QUEUE_ADD, QUEUE_MOVE, QUEUE_REMOVE, QUEUE_PUSH, QUEUE_UPDATE } from '../../shared/actionTypes.js'

// ------------------------------------
// Action Handlers
// ------------------------------------
const ACTION_HANDLERS = {
  [QUEUE_ADD]: async (sock, { payload }, acknowledge) => {
    const { songId, coSingers } = payload

    try {
      await Rooms.validate(sock.user.roomId, null, { validatePassword: false })
    } catch (err) {
      return acknowledge({
        type: QUEUE_ADD + '_ERROR',
        error: err.message,
      })
    }

    Queue.add({
      roomId: sock.user.roomId,
      songId,
      userId: sock.user.userId,
      coSingers: coSingers || null,
    })

    logQueueAction('QUEUE_ADD', sock.user.userId, sock.user.roomId, `songId=${songId}`)

    // success
    acknowledge({ type: QUEUE_ADD + '_SUCCESS' })

    // to all in room
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: QUEUE_PUSH,
      payload: Queue.get(sock.user.roomId),
    })
  },
  [QUEUE_MOVE]: async (sock, { payload }, acknowledge) => {
    const { queueId, prevQueueId } = payload

    try {
      await Rooms.validate(sock.user.roomId, null, { validatePassword: false })
    } catch (err) {
      return acknowledge({
        type: QUEUE_MOVE + '_ERROR',
        error: err.message,
      })
    }

    if (!sock.user.isAdmin && !(Queue.isOwner(sock.user.userId, queueId))) {
      return acknowledge({
        type: QUEUE_MOVE + '_ERROR',
        error: 'Cannot move another user\'s song',
      })
    }

    Queue.move({
      prevQueueId,
      queueId,
      roomId: sock.user.roomId,
    })

    logQueueAction('QUEUE_MOVE', sock.user.userId, sock.user.roomId, `queueId=${queueId} after prevQueueId=${prevQueueId}`)

    // success
    acknowledge({ type: QUEUE_MOVE + '_SUCCESS' })

    // tell room
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: QUEUE_PUSH,
      payload: Queue.get(sock.user.roomId),
    })
  },
  [QUEUE_REMOVE]: (sock, { payload }, acknowledge) => {
    const { queueId } = payload
    const ids = Array.isArray(queueId) ? queueId : [queueId]

    if (!sock.user.isAdmin && !(Queue.isOwner(sock.user.userId, ids))) {
      return acknowledge({
        type: QUEUE_REMOVE + '_ERROR',
        error: 'Cannot remove another user\'s song',
      })
    }

    for (const id of ids) {
      Queue.remove(id)
    }

    logQueueAction('QUEUE_REMOVE', sock.user.userId, sock.user.roomId, `queueId=${JSON.stringify(queueId)}`)

    // success
    acknowledge({ type: QUEUE_REMOVE + '_SUCCESS' })

    // tell room
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: QUEUE_PUSH,
      payload: Queue.get(sock.user.roomId),
    })
  },
  [QUEUE_UPDATE]: async (sock, { payload }, acknowledge) => {
    const { queueId, coSingers } = payload

    // Only owner or admin can update
    if (!sock.user.isAdmin && !(await Queue.isOwner(sock.user.userId, queueId))) {
      return acknowledge({
        type: QUEUE_UPDATE + '_ERROR',
        error: 'Cannot update another user\'s song',
      })
    }

    await Queue.updateCoSingers({ queueId, coSingers })

    // success
    acknowledge({ type: QUEUE_UPDATE + '_SUCCESS' })

    // tell room
    sock.server.to(Rooms.prefix(sock.user.roomId)).emit('action', {
      type: QUEUE_PUSH,
      payload: await Queue.get(sock.user.roomId),
    })
  },
}

export default ACTION_HANDLERS
