import React, { useCallback, useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import Accordion from 'components/Accordion/Accordion'
import Button from 'components/Button/Button'
import Icon from 'components/Icon/Icon'
import {
  getKodiBridgeStatus,
  setKodiBridgeConfig,
  startKodiBridge,
  stopKodiBridge,
  type KodiBridgeConfig,
} from 'store/modules/kodiBridge'
import styles from './KodiBridgePrefs.css'

const KodiBridgePrefs = () => {
  const dispatch = useAppDispatch()
  const { isRunning, config } = useAppSelector(state => state.kodiBridge)
  const rooms = useAppSelector(state => state.rooms)

  // Local form state - Kodi Connection
  const [host, setHost] = useState('')
  const [port, setPort] = useState('8080')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [roomId, setRoomId] = useState<number | ''>('')

  // Streaming Mode
  const [streamMode, setStreamMode] = useState<'http' | 'file'>('http')
  const [serverUrl, setServerUrl] = useState('')
  const [pathFrom, setPathFrom] = useState('')
  const [pathTo, setPathTo] = useState('')

  // ADB Configuration
  const [adbEnabled, setAdbEnabled] = useState(false)
  const [adbHost, setAdbHost] = useState('')
  const [adbPort, setAdbPort] = useState('5555')
  const [kodiPackage, setKodiPackage] = useState('org.xbmc.kodi')

  // Idle Screen Configuration
  const [idleScreenEnabled, setIdleScreenEnabled] = useState(true)
  const [idleScreenUrl, setIdleScreenUrl] = useState('')

  // Load status on mount
  useEffect(() => {
    dispatch(getKodiBridgeStatus())
  }, [dispatch])

  // Sync form state with config when it changes
  useEffect(() => {
    if (config) {
      setHost(config.host || '')
      setPort(String(config.port || 8080))
      setUsername(config.username || '')
      setPassword(config.password || '')
      setRoomId(config.roomId || '')
      setStreamMode(config.streamMode || 'http')
      setServerUrl(config.serverUrl || '')
      setPathFrom(config.pathFrom || '')
      setPathTo(config.pathTo || '')
      // ADB
      setAdbEnabled(config.adb?.enabled || false)
      setAdbHost(config.adb?.host || '')
      setAdbPort(String(config.adb?.port || 5555))
      setKodiPackage(config.adb?.kodiPackage || 'org.xbmc.kodi')
      // Idle Screen
      setIdleScreenEnabled(config.idleScreen?.enabled !== false)
      setIdleScreenUrl(config.idleScreen?.mediaUrl || '')
    }
  }, [config])

  // Auto-detect server URL from current window location
  useEffect(() => {
    if (!serverUrl && typeof window !== 'undefined') {
      const detectedUrl = `${window.location.protocol}//${window.location.host}`
      setServerUrl(detectedUrl)
    }
  }, [serverUrl])

  const handleSave = useCallback(() => {
    if (!host || !roomId) return

    const newConfig: KodiBridgeConfig = {
      host,
      port: parseInt(port, 10) || 8080,
      username: username || undefined,
      password: password || undefined,
      enabled: true,
      roomId: roomId as number,
      streamMode,
      serverUrl: streamMode === 'http' ? serverUrl : undefined,
      pathFrom: streamMode === 'file' ? pathFrom : undefined,
      pathTo: streamMode === 'file' ? pathTo : undefined,
      // ADB config
      adb: adbEnabled ? {
        enabled: true,
        host: adbHost || undefined,
        port: parseInt(adbPort, 10) || 5555,
        kodiPackage: kodiPackage || 'org.xbmc.kodi',
      } : undefined,
      // Idle screen config
      idleScreen: {
        enabled: idleScreenEnabled,
        mediaUrl: idleScreenUrl || undefined,
      },
    }

    dispatch(setKodiBridgeConfig(newConfig))
  }, [dispatch, host, port, username, password, roomId, streamMode, serverUrl, pathFrom, pathTo,
      adbEnabled, adbHost, adbPort, kodiPackage, idleScreenEnabled, idleScreenUrl])

  const handleStart = useCallback(() => {
    // Save config first, then start
    handleSave()
    dispatch(startKodiBridge())
  }, [dispatch, handleSave])

  const handleStop = useCallback(() => {
    dispatch(stopKodiBridge())
  }, [dispatch])

  const isConfigValid = host && roomId && (streamMode === 'http' ? serverUrl : (pathFrom && pathTo))

  return (
    <Accordion
      className={styles.container}
      headingComponent={(
        <div className={styles.heading}>
          <Icon icon='CLOUD' size={32} className={styles.icon} />
          <div className={styles.title}>KodiBridge Player</div>
        </div>
      )}
    >
      <div className={styles.content}>
        {/* Status indicator */}
        <div className={`${styles.status} ${isRunning ? styles.statusRunning : styles.statusStopped}`}>
          <div className={styles.statusIndicator} />
          {isRunning ? 'KodiBridge is running' : 'KodiBridge is stopped'}
        </div>

        {/* Configuration form */}
        <div className={styles.form}>
          {/* Kodi Connection */}
          <div className={styles.section}>
            <label className={styles.sectionLabel}>Kodi Connection</label>
            <div className={styles.row}>
              <div className={styles.field}>
                <label htmlFor='kodi-host'>Kodi Host / IP</label>
                <input
                  id='kodi-host'
                  type='text'
                  value={host}
                  onChange={e => setHost(e.target.value)}
                  placeholder='192.168.1.x'
                  disabled={isRunning}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor='kodi-port'>Port</label>
                <input
                  id='kodi-port'
                  type='number'
                  value={port}
                  onChange={e => setPort(e.target.value)}
                  placeholder='8080'
                  disabled={isRunning}
                />
              </div>
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label htmlFor='kodi-username'>Username (optional)</label>
                <input
                  id='kodi-username'
                  type='text'
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder='kodi'
                  disabled={isRunning}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor='kodi-password'>Password (optional)</label>
                <input
                  id='kodi-password'
                  type='password'
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={isRunning}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor='kodi-room'>Room</label>
              <select
                id='kodi-room'
                value={roomId}
                onChange={e => setRoomId(e.target.value ? parseInt(e.target.value, 10) : '')}
                disabled={isRunning}
              >
                <option value=''>Select a room...</option>
                {rooms.result.map(id => (
                  <option key={id} value={id}>
                    {rooms.entities[id].name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Streaming Mode */}
          <div className={styles.section}>
            <label className={styles.sectionLabel}>Media Streaming</label>
            <p className={styles.helpText}>
              How Kodi should access media files from this server.
            </p>

            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type='radio'
                  name='streamMode'
                  value='http'
                  checked={streamMode === 'http'}
                  onChange={() => setStreamMode('http')}
                  disabled={isRunning}
                />
                <span className={styles.radioText}>
                  <strong>HTTP Streaming (recommended)</strong>
                  <span className={styles.radioDesc}>KES streams files to Kodi via HTTP. No network share needed.</span>
                </span>
              </label>

              <label className={styles.radioLabel}>
                <input
                  type='radio'
                  name='streamMode'
                  value='file'
                  checked={streamMode === 'file'}
                  onChange={() => setStreamMode('file')}
                  disabled={isRunning}
                />
                <span className={styles.radioText}>
                  <strong>Direct File Access (SMB/NFS)</strong>
                  <span className={styles.radioDesc}>Kodi reads files directly from a network share.</span>
                </span>
              </label>
            </div>

            {/* HTTP Streaming options */}
            {streamMode === 'http' && (
              <div className={styles.modeOptions}>
                <div className={styles.field}>
                  <label htmlFor='kodi-server-url'>KES Server URL (as seen by Kodi)</label>
                  <input
                    id='kodi-server-url'
                    type='text'
                    value={serverUrl}
                    onChange={e => setServerUrl(e.target.value)}
                    placeholder='http://192.168.1.10:8080'
                    disabled={isRunning}
                  />
                  <span className={styles.fieldHint}>
                    The URL that Kodi will use to reach this server.
                  </span>
                </div>
              </div>
            )}

            {/* Direct File Access options */}
            {streamMode === 'file' && (
              <div className={styles.modeOptions}>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label htmlFor='kodi-path-from'>Local Path (on KES server)</label>
                    <input
                      id='kodi-path-from'
                      type='text'
                      value={pathFrom}
                      onChange={e => setPathFrom(e.target.value)}
                      placeholder='F:\Music or /home/user/music'
                      disabled={isRunning}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor='kodi-path-to'>Kodi Path (network share)</label>
                    <input
                      id='kodi-path-to'
                      type='text'
                      value={pathTo}
                      onChange={e => setPathTo(e.target.value)}
                      placeholder='smb://server/music'
                      disabled={isRunning}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ADB Auto-Launch */}
          <div className={styles.section}>
            <label className={styles.sectionLabel}>Auto-Launch Kodi (ADB)</label>
            <p className={styles.helpText}>
              Automatically launch Kodi via ADB if it&apos;s not running (Freebox Player, Android TV).
            </p>

            <label className={styles.checkboxLabel}>
              <input
                type='checkbox'
                checked={adbEnabled}
                onChange={e => setAdbEnabled(e.target.checked)}
                disabled={isRunning}
              />
              {' '}Enable ADB auto-launch
            </label>

            {adbEnabled && (
              <div className={styles.modeOptions}>
                <div className={styles.row}>
                  <div className={styles.field}>
                    <label htmlFor='adb-host'>ADB Host (optional)</label>
                    <input
                      id='adb-host'
                      type='text'
                      value={adbHost}
                      onChange={e => setAdbHost(e.target.value)}
                      placeholder={host || 'Same as Kodi host'}
                      disabled={isRunning}
                    />
                    <span className={styles.fieldHint}>
                      Leave empty to use Kodi host address.
                    </span>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor='adb-port'>ADB Port</label>
                    <input
                      id='adb-port'
                      type='number'
                      value={adbPort}
                      onChange={e => setAdbPort(e.target.value)}
                      placeholder='5555'
                      disabled={isRunning}
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor='kodi-package'>Kodi Package Name</label>
                  <input
                    id='kodi-package'
                    type='text'
                    value={kodiPackage}
                    onChange={e => setKodiPackage(e.target.value)}
                    placeholder='org.xbmc.kodi'
                    disabled={isRunning}
                  />
                  <span className={styles.fieldHint}>
                    Usually org.xbmc.kodi for official Kodi.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Idle Screen */}
          <div className={styles.section}>
            <label className={styles.sectionLabel}>Idle Screen</label>
            <p className={styles.helpText}>
              Display an image or video on Kodi when no song is playing.
            </p>

            <label className={styles.checkboxLabel}>
              <input
                type='checkbox'
                checked={idleScreenEnabled}
                onChange={e => setIdleScreenEnabled(e.target.checked)}
                disabled={isRunning}
              />
              {' '}Enable idle screen (Karaoke Eternal logo by default)
            </label>

            {idleScreenEnabled && (
              <div className={styles.modeOptions}>
                <div className={styles.field}>
                  <label htmlFor='idle-screen-url'>Custom Media URL (optional)</label>
                  <input
                    id='idle-screen-url'
                    type='text'
                    value={idleScreenUrl}
                    onChange={e => setIdleScreenUrl(e.target.value)}
                    placeholder='Leave empty for default logo'
                    disabled={isRunning}
                  />
                  <span className={styles.fieldHint}>
                    URL to an image or video. Leave empty to use the Karaoke Eternal logo.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className={styles.buttons}>
            {!isRunning ? (
              <>
                <Button
                  onClick={handleSave}
                  disabled={!isConfigValid}
                  variant='default'
                >
                  Save
                </Button>
                <Button
                  onClick={handleStart}
                  disabled={!isConfigValid}
                  variant='primary'
                >
                  Start KodiBridge
                </Button>
              </>
            ) : (
              <Button
                onClick={handleStop}
                variant='danger'
              >
                Stop KodiBridge
              </Button>
            )}
          </div>
        </div>
      </div>
    </Accordion>
  )
}

export default KodiBridgePrefs
