import getLogger from '../lib/Log.js'
import Library from '../Library/Library.js'
import Prefs from './Prefs.js'
import { LIBRARY_PUSH, PREFS_PATH_SET_PRIORITY, PREFS_PUSH, PREFS_SET, _ERROR } from '../../shared/actionTypes.js'
const log = getLogger(`server[${process.pid}]`)

// Public preferences that should be sent to all users (not just admins)
const PUBLIC_PREFS = ['isAutoplayEnabled', 'isPlaybackControlPublic']

const ACTION_HANDLERS = {
  [PREFS_SET]: async (sock, { payload }, acknowledge) => {
    if (!sock.user.isAdmin) {
      acknowledge({
        type: PREFS_SET + _ERROR,
        error: 'Unauthorized',
      })
      return
    }

    await Prefs.set(payload.key, payload.data)
    log.info('%s (%s) set pref %s = %s', sock.user.name, sock.id, payload.key, payload.data)

    await pushPrefs(sock, payload.key)
  },
  [PREFS_PATH_SET_PRIORITY]: async (sock, { payload }, acknowledge) => {
    if (!sock.user.isAdmin) {
      acknowledge({
        type: PREFS_PATH_SET_PRIORITY + _ERROR,
        error: 'Unauthorized',
      })
      return
    }

    await Prefs.setPathPriority(payload)
    log.info('%s re-prioritized media folders; pushing library to all', sock.user.name)

    await pushPrefs(sock)

    // invalidate cache
    Library.cache.version = null

    sock.server.emit('action', {
      type: LIBRARY_PUSH,
      payload: await Library.get(),
    })
  },
}

// helper to push prefs to admins (and public prefs to all users)
const pushPrefs = async (sock, changedKey?: string) => {
  const prefs = await Prefs.get()

  // Push full prefs to admins
  for (const s of sock.server.sockets.sockets.values()) {
    if (s.user && s.user.isAdmin) {
      s.emit('action', {
        type: PREFS_PUSH,
        payload: prefs,
      })
    }
  }

  // If a public pref changed, push public prefs to all non-admin users
  if (!changedKey || PUBLIC_PREFS.includes(changedKey)) {
    const publicPrefs = {
      isAutoplayEnabled: prefs.isAutoplayEnabled,
      isPlaybackControlPublic: prefs.isPlaybackControlPublic,
    }

    for (const s of sock.server.sockets.sockets.values()) {
      if (s.user && !s.user.isAdmin) {
        s.emit('action', {
          type: PREFS_PUSH,
          payload: publicPrefs,
        })
      }
    }
  }
}

export default ACTION_HANDLERS
