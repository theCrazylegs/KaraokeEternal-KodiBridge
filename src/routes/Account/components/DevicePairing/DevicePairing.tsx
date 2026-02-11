import React, { useRef, useState } from 'react'
import HttpApi from 'lib/HttpApi'
import Panel from 'components/Panel/Panel'
import Button from 'components/Button/Button'
import styles from './DevicePairing.css'

const api = new HttpApi('pair/')

const DevicePairing = () => {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const code = inputRef.current?.value.trim().toUpperCase()

    if (!code || code.length !== 4) {
      setStatus('error')
      setMessage('Please enter the 4-character code shown on the TV.')
      inputRef.current?.focus()
      return
    }

    setStatus('loading')
    setMessage('')

    try {
      await api.post<{ success: boolean }>('confirm', {
        body: { code },
      })

      setStatus('success')
      setMessage('Device paired successfully!')
      inputRef.current.value = ''
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Pairing failed')
      inputRef.current?.select()
    }
  }

  return (
    <Panel title='Link a Device' contentClassName={styles.content}>
      <>
        <p className={styles.description}>
          Enter the code shown on your TV to link it to your account.
        </p>

        <form className={styles.codeForm} onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className={styles.codeInput}
            type='text'
            maxLength={4}
            placeholder='CODE'
            autoComplete='off'
            autoCapitalize='characters'
          />
          <Button type='submit' variant='primary' disabled={status === 'loading'}>
            {status === 'loading' ? 'Linking...' : 'Link'}
          </Button>
        </form>

        {message && (
          <p className={`${styles.status} ${status === 'success' ? styles.success : styles.error}`}>
            {message}
          </p>
        )}
      </>
    </Panel>
  )
}

export default DevicePairing
