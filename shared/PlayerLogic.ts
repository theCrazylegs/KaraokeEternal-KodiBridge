/**
 * Pure logic functions for player state management
 * Used by both Web Player (client) and KodiBridge (server)
 */

import type { QueueItem } from './types.js'

// ------------------------------------
// Types
// ------------------------------------
export interface PlayerStateCore {
  historyJSON: string
  isAtQueueEnd: boolean
  isPlaying: boolean
  isVideoKeyingEnabled: boolean
  mediaType: string | null
  position: number
  queueId: number
  nextUserId: number | null
  _isPlayingNext: boolean
  _isReplayingQueueId: number | null
}

export interface QueueData {
  result: number[]
  entities: Record<number, QueueItem>
}

// ------------------------------------
// Helper Functions
// ------------------------------------

/**
 * Get the current queue item
 */
export function getCurrentQueueItem(
  queue: QueueData,
  queueId: number
): QueueItem | undefined {
  return queue.entities[queueId]
}

/**
 * Get the next queue item after the current one
 */
export function getNextQueueItem(
  queue: QueueData,
  currentQueueId: number
): QueueItem | undefined {
  const currentIndex = queue.result.indexOf(currentQueueId)
  const nextQueueId = queue.result[currentIndex + 1]
  return nextQueueId !== undefined ? queue.entities[nextQueueId] : undefined
}

// ------------------------------------
// Core Logic Functions
// ------------------------------------

/**
 * Compute next state when loading next song in queue
 * Handles history management and queue exhaustion
 */
export function computeLoadNext(
  queue: QueueData,
  currentState: Pick<PlayerStateCore, 'historyJSON' | 'queueId'>
): Partial<PlayerStateCore> {
  const history: number[] = JSON.parse(currentState.historyJSON)
  const queueItem = getCurrentQueueItem(queue, currentState.queueId)
  const nextQueueItem = getNextQueueItem(queue, currentState.queueId)

  // add current item to history (once)
  if (queueItem && history.lastIndexOf(queueItem.queueId) === -1) {
    history.push(queueItem.queueId)
  }

  // queue exhausted?
  if (!nextQueueItem) {
    return {
      historyJSON: JSON.stringify(history),
      isAtQueueEnd: true,
      mediaType: null,
      _isPlayingNext: false,
    }
  }

  // play next
  return {
    historyJSON: JSON.stringify(history),
    isAtQueueEnd: false,
    isPlaying: true,
    isVideoKeyingEnabled: nextQueueItem.isVideoKeyingEnabled,
    mediaType: nextQueueItem.mediaType,
    position: 0,
    queueId: nextQueueItem.queueId,
    nextUserId: null,
    _isPlayingNext: false,
  }
}

/**
 * Compute next state when replaying a specific song
 * Handles history reset up to the replaying song
 */
export function computeReplay(
  queue: QueueData,
  currentState: Pick<PlayerStateCore, 'historyJSON' | 'queueId'>,
  replayQueueId: number
): Partial<PlayerStateCore> | null {
  const nextItem = queue.entities[replayQueueId]
  if (!nextItem) return null

  const history: number[] = JSON.parse(currentState.historyJSON)

  if (replayQueueId !== currentState.queueId) {
    // reset history up to and including the replaying queueId
    const idx = history.lastIndexOf(replayQueueId)
    if (idx !== -1) history.splice(idx)
  }

  return {
    historyJSON: JSON.stringify(history),
    isAtQueueEnd: false,
    isPlaying: true,
    isVideoKeyingEnabled: nextItem.isVideoKeyingEnabled,
    mediaType: nextItem.mediaType,
    position: 0,
    queueId: nextItem.queueId,
    nextUserId: null,
    _isReplayingQueueId: null,
  }
}

/**
 * Find the next user that isn't the currently up user
 * Used to display "up next" information
 */
export function findNextUserId(
  queue: QueueData,
  currentQueueId: number,
  currentNextUserId: number | null
): number | null {
  const queueItem = getCurrentQueueItem(queue, currentQueueId)
  const nextQueueItem = getNextQueueItem(queue, currentQueueId)

  // if we already have a nextUserId and next item user matches, keep it
  if (currentNextUserId && queueItem?.userId !== nextQueueItem?.userId) {
    return currentNextUserId
  }

  // find the next user that isn't the current user
  const currentIndex = queue.result.indexOf(queueItem?.queueId ?? -1)
  for (let i = currentIndex + 1; i < queue.result.length; i++) {
    const item = queue.entities[queue.result[i]]
    if (queueItem?.userId !== item.userId) {
      return item.userId
    }
  }

  return null
}

/**
 * Check if we should load next when queue was exhausted but is no longer
 */
export function shouldResumeFromQueueEnd(
  queue: QueueData,
  currentState: Pick<PlayerStateCore, 'isAtQueueEnd' | 'isPlaying' | 'queueId'>
): boolean {
  const nextQueueItem = getNextQueueItem(queue, currentState.queueId)
  return currentState.isAtQueueEnd && !!nextQueueItem && currentState.isPlaying
}

/**
 * Check if we should load next (first time playing or playing next)
 */
export function shouldLoadNext(
  currentState: Pick<PlayerStateCore, 'isPlaying' | 'queueId' | '_isPlayingNext'>
): boolean {
  return (currentState.isPlaying && currentState.queueId === -1) || currentState._isPlayingNext
}

/**
 * Check if we should replay
 */
export function shouldReplay(
  currentState: Pick<PlayerStateCore, '_isReplayingQueueId'>
): boolean {
  return currentState._isReplayingQueueId !== null
}
