import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import type { SessionUser } from '../lib/api'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  user: SessionUser
  onSignOut: () => Promise<void>
  onRename: (name: string) => Promise<void>
  onChangePin: (currentPin: string, newPin: string) => Promise<void>
}

export function SettingsDialog({
  open,
  onClose,
  user,
  onSignOut,
  onRename,
  onChangePin,
}: SettingsDialogProps) {
  const [name, setName] = useState(user.displayName)
  const [profileNote, setProfileNote] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinNote, setPinNote] = useState<string | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(user.displayName)
  }, [user.displayName])

  useEffect(() => {
    if (!open) {
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
      setPinNote(null)
      setPinError(null)
      setProfileNote(null)
      setProfileError(null)
    }
  }, [open])

  const saveName = async () => {
    if (!name.trim()) {
      setProfileError('A display name is required.')
      setProfileNote(null)
      return
    }
    setBusy(true)
    setProfileError(null)
    setProfileNote(null)
    try {
      await onRename(name.trim())
      setProfileNote('Name saved.')
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not save your name.')
    } finally {
      setBusy(false)
    }
  }

  const savePin = async () => {
    setPinError(null)
    setPinNote(null)
    if (newPin.length !== 6 || currentPin.length !== 6) {
      setPinError('Both PINs need to be 6 digits.')
      return
    }
    if (newPin !== confirmPin) {
      setPinError('The new PIN and its confirmation do not match.')
      return
    }
    setBusy(true)
    try {
      await onChangePin(currentPin, newPin)
      setPinNote('PIN changed. Other devices were signed out.')
      setCurrentPin('')
      setNewPin('')
      setConfirmPin('')
    } catch (error) {
      setPinError(error instanceof Error ? error.message : 'Could not change the PIN.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Settings" onClose={onClose}>
      <section className="settings__section">
        <h3 className="settings__heading">You</h3>
        <div className="settings__id">
          <span className="muted">Your ID</span>
          <span className="mono settings__id-value">{user.userId}</span>
          <button
            type="button"
            className="link"
            onClick={() => void navigator.clipboard.writeText(user.userId)}
          >
            Copy
          </button>
        </div>
        <label className="field">
          <span>Display name</span>
          <input
            value={name}
            maxLength={40}
            required
            aria-required="true"
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </label>
        {profileError ? (
          <p className="form-error" role="alert">
            {profileError}
          </p>
        ) : null}
        {profileNote ? <p className="form-note">{profileNote}</p> : null}
        <p className="muted settings__hint">
          People see this name when they share a note with you.
        </p>
      </section>

      <section className="settings__section">
        <h3 className="settings__heading">Change PIN</h3>
        <div className="pin-grid">
          <label className="field">
            <span>Current PIN</span>
            <input
              inputMode="numeric"
              type="password"
              maxLength={6}
              value={currentPin}
              onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <label className="field">
            <span>New PIN</span>
            <input
              inputMode="numeric"
              type="password"
              maxLength={6}
              value={newPin}
              onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <label className="field">
            <span>Again</span>
            <input
              inputMode="numeric"
              type="password"
              maxLength={6}
              value={confirmPin}
              onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
        </div>
        {pinError ? (
          <p className="form-error" role="alert">
            {pinError}
          </p>
        ) : null}
        {pinNote ? <p className="form-note">{pinNote}</p> : null}
        <button type="button" className="btn btn--ghost" onClick={savePin} disabled={busy}>
          Change PIN
        </button>
      </section>

      <section className="settings__section settings__section--last">
        <button type="button" className="btn btn--ghost btn--full" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </section>
    </Modal>
  )
}
