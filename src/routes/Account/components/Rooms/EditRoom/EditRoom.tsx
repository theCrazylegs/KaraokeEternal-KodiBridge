import React, { useRef, useState } from 'react'
import { useAppDispatch } from 'store/hooks'
import { createRoom, removeRoom, updateRoom, requestPrefsPush } from 'store/modules/rooms'
import { getFormData } from 'lib/util'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import UserPrefs from './UserPrefs/UserPrefs'
import QRPrefs from './QRPrefs/QRPrefs'
import type { Room, IRoomPrefs } from 'shared/types'
import styles from './EditRoom.css'

interface EditRoomProps {
  room?: Room
  onClose: () => void
}

const EditRoom = ({ onClose, room }: EditRoomProps) => {
  const formRef = useRef(null)
  const [roomPassword, setRoomPassword] = useState(room && room.hasPassword ? '*'.repeat(32) : '')
  const [prefs, setPrefs] = useState<IRoomPrefs>(room?.prefs || {} as IRoomPrefs)
  const [prevRoom, setPrevRoom] = useState(room)
  const [isPasswordDirty, setIsPasswordDirty] = useState(false)
  const dispatch = useAppDispatch()

  if (room !== prevRoom) {
    setPrevRoom(room)
    if (room?.prefs) setPrefs(room.prefs)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const data = getFormData(new FormData(formRef.current)) as Record<string, string | IRoomPrefs>
    data.prefs = prefs

    if (room) {
      if (!isPasswordDirty) delete data.password
      dispatch(updateRoom({ roomId: room.roomId, data }))
    } else {
      if (!data.password) delete data.password
      dispatch(createRoom(data))
    }
  }

  const handleRemoveClick = () => {
    if (room && confirm(`Remove room "${room.name}" and its queue?`)) {
      dispatch(removeRoom(room.roomId))
    }
  }

  const handlePrefsChange = (newPrefs: IRoomPrefs) => {
    setPrefs(newPrefs)
    if (room) {
      dispatch(requestPrefsPush(room.roomId, newPrefs))
    }
  }

  const handleClose = () => {
    // emit initial prefs
    if (room) {
      dispatch(requestPrefsPush(room.roomId, room.prefs))
    }
    onClose()
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsPasswordDirty(true)
    setRoomPassword(e.target.value)
  }

  let nfcUrl: string | null = null
  if (room) {
    const url = new URL('account', document.baseURI)
    url.searchParams.set('roomId', String(room.roomId))
    url.searchParams.set('mode', 'guest')
    const knownPassword = isPasswordDirty ? roomPassword : (prefs?.qr?.password ?? '')
    if (knownPassword) url.searchParams.set('password', btoa(knownPassword))
    nfcUrl = url.href
  }

  return (
    <Modal
      className={styles.modal}
      onClose={handleClose}
      title={room ? 'Edit Room' : 'Create Room'}
    >
      <form onSubmit={handleSubmit} ref={formRef} className={styles.form}>
        <div className={styles.fieldContainer}>
          <input
            type='text'
            autoComplete='off'
            defaultValue={room ? room.name : ''}
            name='name'
            placeholder='room name'
            // https://github.com/facebook/react/issues/23301
            ref={r => typeof room === 'undefined' ? r?.setAttribute('autofocus', 'true') : undefined}
          />

          <input
            type='password'
            autoComplete='new-password'
            value={roomPassword}
            name='password'
            onChange={handlePasswordChange}
            onFocus={e => e.target.select()}
            placeholder='room password (optional)'
          />

          <select
            name='status'
            defaultValue={room?.status ?? 'open'}
          >
            <option value='open'>Open</option>
            <option value='closed'>Closed</option>
          </select>
        </div>

        {room && (
          <div className={styles.nfcContainer}>
            <label>URL carte NFC (accès guest)</label>
            <input
              type='text'
              readOnly
              value={nfcUrl ?? ''}
              className={styles.nfcUrlInput}
              onFocus={e => e.target.select()}
            />
            {room.hasPassword && !isPasswordDirty && !prefs?.qr?.password && (
              <p className={styles.nfcHint}>
                Re-saisir le mot de passe de la room pour l'inclure dans l'URL
              </p>
            )}
          </div>
        )}

        <div className={styles.prefsContainer}>
          <UserPrefs prefs={prefs} onChange={handlePrefsChange} />
          <QRPrefs prefs={prefs} onChange={handlePrefsChange} roomPassword={roomPassword} roomPasswordDirty={isPasswordDirty} />
        </div>

        <div className={styles.btnContainer}>
          <Button type='submit' variant='primary' className={styles.btn}>
            {room ? 'Update Room' : 'Create Room'}
          </Button>
          {room && (
            <Button onClick={handleRemoveClick} className={styles.btn} variant='danger'>
              Remove Room
            </Button>
          )}
          <Button onClick={handleClose} variant='default'>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default EditRoom
