import React from 'react'
import Panel from 'components/Panel/Panel'
import PathPrefs from './PathPrefs/PathPrefs'
import PlayerPrefs from './PlayerPrefs/PlayerPrefs'
import KodiBridgePrefs from './KodiBridgePrefs/KodiBridgePrefs'
import styles from './Prefs.css'

const Prefs = () => (
  <Panel title='Preferences' contentClassName={styles.content}>
    <>
      <PathPrefs />
      <PlayerPrefs />
      <KodiBridgePrefs />
    </>
  </Panel>
)

export default Prefs
