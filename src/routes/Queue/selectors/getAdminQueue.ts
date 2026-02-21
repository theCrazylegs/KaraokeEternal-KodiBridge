import { RootState } from 'store/store'
import { ensureState } from 'redux-optimistic-ui'
import { createSelector } from '@reduxjs/toolkit'
import type { QueueItem } from 'shared/types'
import getPlayerHistory from './getPlayerHistory'

const getResult = (state: RootState) => ensureState(state.queue).result
const getEntities = (state: RootState) => ensureState(state.queue).entities
const getQueueId = (state: RootState) => state.status.queueId
const getNextUserId = (state: RootState) => state.status.nextUserId

/**
 * Returns the queue for admin view: history/current/next first (same logic as round-robin),
 * but upcoming items are kept in raw DB position order (NOT round-robin interleaved).
 *
 * This allows drag-and-drop to work predictably for all songs — including guests' songs.
 * With round-robin display, dragging a guest song between admin songs had no visible effect
 * because the round-robin algorithm would recompute and put the guest song back to its
 * interleaved position. In raw DB order, what you drag is what you get.
 *
 * Regular users still see the round-robin (fair) view via getRoundRobinQueue.
 */
const getAdminQueue = createSelector(
  [getResult, getEntities, getPlayerHistory, getQueueId, getNextUserId],
  (result, entities, history, curId, nextUserId) => {
    // Mirror the history-building logic from getRoundRobinQueue
    history = history.filter(queueId => result.includes(queueId))

    if (entities[curId] && history.lastIndexOf(curId) === -1) {
      history.push(curId)
    }

    if (nextUserId !== null) {
      for (const queueId of result) {
        if (!history.includes(queueId) && entities[queueId].isOptimistic !== true && entities[queueId].userId === nextUserId) {
          history.push(queueId)
          break
        }
      }
    }

    // Upcoming items in raw DB position order (ORDER BY position ASC from server)
    const upcoming = result.filter(qId =>
      !history.includes(qId) &&
      entities[qId]?.isOptimistic !== true
    )

    return {
      result: history.concat(upcoming) as number[],
      entities: entities as Record<number, QueueItem>,
    }
  },
)

export default getAdminQueue
