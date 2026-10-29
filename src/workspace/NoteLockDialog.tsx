import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { useTouchKeyboardDevice } from '../hooks/useTouchKeyboard'

interface LockNoteDialogProps {
  open: boolean
  noteTitle: string
  onClose: () => void
  onLock: (password: string | null) => Promise<void>
}

export function LockNoteDialog({ open, noteTitle, onClose, onLock }: LockNoteDialogProps) {
  const [requirePassword, setRequirePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const touchKeyboard = useTouchKeyboardDevice()

  useEffect(() => {
    if (!open) return
    setRequirePassword(false)
    setPassword('')
    setBusy(false)
    setError(null)
  }, [open])

  const submit = async () => {
    const value = requirePassword ? password : ''
    if (requirePassword && value.trim().length < 4) {
      setError('Use a password with at least 4 characters.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onLock(value || null)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not lock this note.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Lock note"
      size="sm"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? 'Locking…' : 'Lock note'}
          </button>
        </>
      }
    >
      <p className="modal__lede">
        “{noteTitle}” becomes read-only for everyone, including you. Unlock it for a visit to
        edit; it locks again when you leave the note.
      </p>

      <label className="check-row">
        <input
          type="checkbox"
          checked={requirePassword}
          onChange={(event) => setRequirePassword(event.target.checked)}
        />
        <span>Ask people it’s shared with for a password before they can unlock it</span>
      </label>

      {requirePassword ? (
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            maxLength={128}
            autoComplete="new-password"
            inputMode={touchKeyboard ? 'none' : undefined}
            autoFocus
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
          />
        </label>
      ) : null}

      <p className="lock-hint">
        {requirePassword
          ? 'Anyone the note is shared with can unlock it with this password. It is stored hashed.'
          : 'Without a password, only you can unlock this note.'}
      </p>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  )
}

interface UnlockNoteDialogProps {
  open: boolean
  noteTitle: string
  onClose: () => void
  onUnlock: (password: string) => Promise<void>
}

export function UnlockNoteDialog({ open, noteTitle, onClose, onUnlock }: UnlockNoteDialogProps) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const touchKeyboard = useTouchKeyboardDevice()

  useEffect(() => {
    if (!open) return
    setPassword('')
    setBusy(false)
    setError(null)
  }, [open])

  const submit = async () => {
    if (!password) {
      setError('Enter the note password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onUnlock(password)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not unlock this note.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Unlock note"
      size="sm"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void submit()}
            disabled={busy || !password}
          >
            {busy ? 'Unlocking…' : 'Unlock for this visit'}
          </button>
        </>
      }
    >
      <p className="modal__lede">
        “{noteTitle}” is read-only. Enter its password to edit it until you leave the note.
      </p>
      <label className="field">
        <span>Note password</span>
        <input
          type="password"
          value={password}
          maxLength={128}
          autoComplete="current-password"
          inputMode={touchKeyboard ? 'none' : undefined}
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  )
}
