import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { api, type SessionUser } from '../lib/api'

interface AdminUser {
  userId: string
  displayName: string
  isAdmin: boolean
  noteCount: number
}

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  user: SessionUser
  token: string | null
  onSignOut: () => Promise<void>
  onRename: (name: string) => Promise<void>
  onChangePin: (currentPin: string, newPin: string) => Promise<void>
}

export function SettingsDialog({
  open,
  onClose,
  user,
  token,
  onSignOut,
  onRename,
  onChangePin,
}: SettingsDialogProps) {
  const [name, setName] = useState(user.displayName)
  const [profileNote, setProfileNote] = useState<string | null>(null)
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinNote, setPinNote] = useState<string | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [managing, setManaging] = useState<string | null>(null)
  const [nextId, setNextId] = useState('')
  const [nextPin, setNextPin] = useState('')
  const [adminNote, setAdminNote] = useState<string | null>(null)

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
      setManaging(null)
      setAdminNote(null)
      setProfileNote(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || !user.isAdmin || !token) return
    let cancelled = false
    api<{ users: AdminUser[] }>('/api/admin/users', { token })
      .then((result) => {
        if (!cancelled) setUsers(result.users)
      })
      .catch((error: unknown) => {
        if (!cancelled) setAdminError(error instanceof Error ? error.message : 'Could not load accounts.')
      })
    return () => {
      cancelled = true
    }
  }, [open, user.isAdmin, token, adminNote])

  const saveName = async () => {
    if (!name.trim()) return
    setBusy(true)
    setProfileNote(null)
    try {
      await onRename(name.trim())
      setProfileNote('Name saved.')
    } catch (error) {
      setProfileNote(error instanceof Error ? error.message : 'Could not save your name.')
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

  const saveUserId = async (currentId: string) => {
    if (!token || nextId.length !== 8) {
      setAdminNote('The new ID must be exactly 8 digits.')
      return
    }
    setBusy(true)
    setAdminNote(null)
    try {
      await api(`/api/admin/users/${currentId}/id`, {
        method: 'POST',
        token,
        body: { userId: nextId },
      })
      if (currentId === user.userId) {
        window.location.reload()
        return
      }
      setAdminNote('ID updated. Tell them to sign in with the new number.')
      setNextId('')
      setManaging(null)
    } catch (error) {
      setAdminNote(error instanceof Error ? error.message : 'Could not change that ID.')
    } finally {
      setBusy(false)
    }
  }

  const resetPin = async (targetId: string) => {
    if (!token || nextPin.length !== 6) {
      setAdminNote('The new PIN must be 6 digits.')
      return
    }
    setBusy(true)
    setAdminNote(null)
    try {
      await api(`/api/admin/users/${targetId}/pin`, {
        method: 'POST',
        token,
        body: { pin: nextPin },
      })
      setAdminNote('PIN reset. They are signed out everywhere and must use the new PIN.')
      setNextPin('')
    } catch (error) {
      setAdminNote(error instanceof Error ? error.message : 'Could not reset that PIN.')
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
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
          />
        </label>
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

      {user.isAdmin ? (
        <section className="settings__section">
          <h3 className="settings__heading">Admin · accounts</h3>
          <p className="muted settings__hint">
            Changing an ID moves every note, session and share with it. Resetting a PIN signs that
            person out everywhere.
          </p>
          {adminError ? <p className="form-error">{adminError}</p> : null}
          {adminNote ? <p className="form-note">{adminNote}</p> : null}
          <div className="admin-list">
            {users?.map((entry) => (
              <div key={entry.userId} className="admin-row">
                <div className="admin-row__head">
                  <div>
                    <span className="admin-row__name">
                      {entry.displayName}
                      {entry.isAdmin ? <span className="badge">admin</span> : null}
                    </span>
                    <span className="mono admin-row__id">{entry.userId}</span>
                  </div>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setManaging(managing === entry.userId ? null : entry.userId)
                      setNextId('')
                      setNextPin('')
                      setAdminNote(null)
                    }}
                  >
                    {managing === entry.userId ? 'Close' : 'Manage'}
                  </button>
                </div>
                {managing === entry.userId ? (
                  <div className="admin-row__tools">
                    <div className="admin-tool">
                      <input
                        className="input input--mono"
                        inputMode="numeric"
                        maxLength={8}
                        placeholder="New 8-digit ID"
                        value={nextId}
                        onChange={(event) => setNextId(event.target.value.replace(/\D/g, '').slice(0, 8))}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => void saveUserId(entry.userId)}
                      >
                        Save ID
                      </button>
                    </div>
                    <div className="admin-tool">
                      <input
                        className="input input--mono"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="New 6-digit PIN"
                        value={nextPin}
                        onChange={(event) => setNextPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => void resetPin(entry.userId)}
                      >
                        Reset PIN
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="settings__section settings__section--last">
        <button type="button" className="btn btn--ghost btn--full" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </section>
    </Modal>
  )
}
