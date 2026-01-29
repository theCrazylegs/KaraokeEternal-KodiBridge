import { createAction, createReducer } from '@reduxjs/toolkit'
import { AppThunk } from 'store/store'
import {
  KODI_BRIDGE_GET_STATUS,
  KODI_BRIDGE_SET_CONFIG,
  KODI_BRIDGE_START,
  KODI_BRIDGE_STOP,
  KODI_BRIDGE_STATUS,
} from 'shared/actionTypes'

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

export interface KodiBridgeState {
  isRunning: boolean
  config: KodiBridgeConfig | null
  isLoading: boolean
  error: string | null
}

// ------------------------------------
// Actions
// ------------------------------------
const kodiBridgeStatus = createAction<{ isRunning: boolean; config: KodiBridgeConfig | null }>(KODI_BRIDGE_STATUS)

export function getKodiBridgeStatus(): AppThunk {
  return (dispatch) => {
    dispatch({
      type: KODI_BRIDGE_GET_STATUS,
      meta: { isOptimistic: false },
    })
  }
}

export function setKodiBridgeConfig(config: KodiBridgeConfig): AppThunk {
  return (dispatch) => {
    dispatch({
      type: KODI_BRIDGE_SET_CONFIG,
      payload: config,
      meta: { isOptimistic: false },
    })
  }
}

export function startKodiBridge(): AppThunk {
  return (dispatch) => {
    dispatch({
      type: KODI_BRIDGE_START,
      meta: { isOptimistic: false },
    })
  }
}

export function stopKodiBridge(): AppThunk {
  return (dispatch) => {
    dispatch({
      type: KODI_BRIDGE_STOP,
      meta: { isOptimistic: false },
    })
  }
}

// ------------------------------------
// Reducer
// ------------------------------------
const initialState: KodiBridgeState = {
  isRunning: false,
  config: null,
  isLoading: false,
  error: null,
}

const kodiBridgeReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(kodiBridgeStatus, (state, { payload }) => ({
      ...state,
      isRunning: payload.isRunning,
      config: payload.config,
      isLoading: false,
      error: null,
    }))
})

export default kodiBridgeReducer
