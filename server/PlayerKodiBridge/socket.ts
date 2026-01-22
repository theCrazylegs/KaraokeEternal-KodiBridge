/**
 * Socket.io handlers for KodiBridge control
 * Allows admin to start/stop KodiBridge and configure it
 */

import kodiBridge, { type KodiBridgeConfig } from './KodiBridge.js'
import {
  KODI_BRIDGE_GET_STATUS,
  KODI_BRIDGE_SET_CONFIG,
  KODI_BRIDGE_START,
  KODI_BRIDGE_STOP,
  KODI_BRIDGE_STATUS,
} from '../../shared/actionTypes.js'

// ------------------------------------
// Action Handlers
// ------------------------------------
const ACTION_HANDLERS = {
  /**
   * Get KodiBridge status and config
   */
  [KODI_BRIDGE_GET_STATUS]: async (sock, action, acknowledge) => {
    if (!sock.user.isAdmin) {
      return acknowledge({ error: 'Unauthorized' })
    }

    const config = await kodiBridge.getConfig()
    const status = kodiBridge.getStatus()

    acknowledge({
      type: KODI_BRIDGE_STATUS,
      payload: {
        isRunning: status.isRunning,
        config,
      },
    })
  },

  /**
   * Set KodiBridge configuration
   */
  [KODI_BRIDGE_SET_CONFIG]: async (sock, { payload }: { payload: KodiBridgeConfig }, acknowledge) => {
    if (!sock.user.isAdmin) {
      return acknowledge({ error: 'Unauthorized' })
    }

    await kodiBridge.setConfig(payload)

    acknowledge({
      type: KODI_BRIDGE_STATUS,
      payload: {
        isRunning: kodiBridge.getIsRunning(),
        config: payload,
      },
    })
  },

  /**
   * Start KodiBridge
   */
  [KODI_BRIDGE_START]: async (sock, action, acknowledge) => {
    if (!sock.user.isAdmin) {
      return acknowledge({ error: 'Unauthorized' })
    }

    const success = await kodiBridge.start()

    if (success) {
      acknowledge({
        type: KODI_BRIDGE_STATUS,
        payload: {
          isRunning: true,
          config: await kodiBridge.getConfig(),
        },
      })
    } else {
      acknowledge({
        error: 'Failed to start KodiBridge. Check Kodi connection.',
      })
    }
  },

  /**
   * Stop KodiBridge
   */
  [KODI_BRIDGE_STOP]: async (sock, action, acknowledge) => {
    if (!sock.user.isAdmin) {
      return acknowledge({ error: 'Unauthorized' })
    }

    await kodiBridge.stop()

    acknowledge({
      type: KODI_BRIDGE_STATUS,
      payload: {
        isRunning: false,
        config: await kodiBridge.getConfig(),
      },
    })
  },
}

export default ACTION_HANDLERS
