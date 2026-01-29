import React, { useCallback } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import Accordion from 'components/Accordion/Accordion'
import Icon from 'components/Icon/Icon'
import { setPref } from 'store/modules/prefs'
import styles from './PlayerPrefs.css'

const PlayerPrefs = () => {
  const isReplayGainEnabled = useAppSelector(state => state.prefs.isReplayGainEnabled)
  const isAutoplayEnabled = useAppSelector(state => state.prefs.isAutoplayEnabled)
  const isPlaybackControlPublic = useAppSelector(state => state.prefs.isPlaybackControlPublic)
  const dispatch = useAppDispatch()

  const toggleCheckbox = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setPref({ key: e.currentTarget.name, data: e.currentTarget.checked }))
  }, [dispatch])

  return (
    <Accordion
      className={styles.container}
      headingComponent={(
        <div className={styles.heading}>
          <Icon icon='TELEVISION_PLAY' size={32} className={styles.icon} />
          <div className={styles.title}>Player</div>
        </div>
      )}
    >
      <div className={styles.content}>
        <label>
          <input
            type='checkbox'
            checked={isAutoplayEnabled}
            onChange={toggleCheckbox}
            name='isAutoplayEnabled'
          />
          {' '}
          Auto-play next song (uncheck to pause between songs)
        </label>
        <label>
          <input
            type='checkbox'
            checked={isPlaybackControlPublic}
            onChange={toggleCheckbox}
            name='isPlaybackControlPublic'
          />
          {' '}
          Allow all users to control playback
        </label>
        <label>
          <input
            type='checkbox'
            checked={isReplayGainEnabled}
            onChange={toggleCheckbox}
            name='isReplayGainEnabled'
          />
          {' '}
          ReplayGain (clip-safe)
        </label>
      </div>
    </Accordion>
  )
}

export default PlayerPrefs
