import { RootState } from 'store/store'
import { ensureState } from 'redux-optimistic-ui'
import { createSelector } from '@reduxjs/toolkit'
import type { QueueItem } from 'shared/types'
import getPlayerHistory from './getPlayerHistory'

const getResult = (state: RootState) => ensureState(state.queue).result
const getEntities = (state: RootState) => ensureState(state.queue).entities
const getQueueId = (state: RootState) => state.status.queueId

/**
 * Returns the queue for display and playback: history/current first, then upcoming
 * items in raw DB position order (ORDER BY position ASC from server).
 *
 * Used by both QueueList (display) and PlayerController (playback), so what you
 * see is what plays. Admin drag-and-drop writes to DB position, which is what
 * this selector returns — ensuring drag reordering affects actual playback order.
 *
 * No nextUserId pinning: that would pin an arbitrary song to position 3 and push
 * songs that precede it in DB order to appear after it, creating visual inconsistency.
 */
const getAdminQueue = createSelector(
  [getResult, getEntities, getPlayerHistory, getQueueId],
  (result, entities, history, curId) => {
    history = history.filter(queueId => result.includes(queueId))

    if (entities[curId] && history.lastIndexOf(curId) === -1) {
      history.push(curId)
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
