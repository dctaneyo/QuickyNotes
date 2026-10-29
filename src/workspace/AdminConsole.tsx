import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import { colorFor, initials } from '../lib/notes'
import { ArrowLeftIcon, SearchIcon, XIcon } from '../components/Icons'
import { Modal } from '../components/Modal'
import { ConnectionBadge } from '../components/ConnectionBadge'
import type { AdminStats, AdminUser, AuditEntry } from '../lib/admin'
import type { Realtime } from '../sync/useEvents'

interface AdminConsoleProps {
  open: boolean
  token: string | null
  currentUserId: string
  events: Realtime
  onClose: () => void
}

const formatJoined = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp))

const formatWhen = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatUptime = (seconds: number) => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function auditText(entry: AuditEntry): string {
  const actor = entry.actorName ?? (entry.actorId ? `Account ${entry.actorId}` : 'An admin')
  const target = entry.targetName ?? entry.targetId ?? 'an account'
  switch (entry.action) {
    case 'unlock':
      return `${actor} unlocked ${target}`
    case 'pin':
      return `${actor} reset the PIN for ${target}`
    case 'id':
      return `${actor} changed an ID (${entry.detail})`
    case 'create':
      return `${actor} created ${target} (${entry.detail})`
    case 'role_admin':
      return `${actor} made ${target} an admin`
    case 'role_member':
      return `${actor} removed admin access from ${target}`
    case 'sessions':
      return `${actor} signed ${target} out everywhere`
    case 'suspend':
      return `${actor} suspended ${target}`
    case 'restore':
      return `${actor} restored access for ${target}`
    case 'delete':
      return `${actor} deleted ${target} (${entry.detail})`
    case 'signups_open':
      return `${actor} opened new signups`
    case 'signups_closed':
      return `${actor} closed new signups`
    case 'backup':
      return `${actor} downloaded a database backup`
    default:
      return `${actor} performed ${entry.action}`
  }
}

export function AdminConsole({
  open,
  token,
  currentUserId,
  events,
  onClose,
}: AdminConsoleProps) {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [managing, setManaging] = useState<string | null>(null)
  const [nextId, setNextId] = useState('')
  const [nextPin, setNextPin] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUserId, setNewUserId] = useState('')
  const [newPin, setNewPin] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const now = Date.now()
  const { adminSnapshot, requestAdmin, status, retry } = events

  useEffect(() => {
    if (!open) return
    setQuery('')
    setManaging(null)
    setNextId('')
    setNextPin('')
    setNotice(null)
    setActionError(null)
    setDeleteTarget(null)
    setDeleteConfirm('')
    setCreateOpen(false)
    setNewName('')
    setNewUserId('')
    setNewPin('')
    setCreateError(null)
    window.requestAnimationFrame(() => backRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open || !adminSnapshot) return
    setUsers(adminSnapshot.users)
    setStats(adminSnapshot.stats)
    setAudit(adminSnapshot.audit)
    setLoading(false)
  }, [open, adminSnapshot])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    requestAdmin()
  }, [open, requestAdmin])

  useEffect(() => {
    if (open && status !== 'online') setLoading(false)
  }, [open, status])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleteTarget && !createOpen) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose, deleteTarget, createOpen])

  const filtered = useMemo(() => {
    if (!users) return []
    const needle = query.trim().toLowerCase()
    if (!needle) return users
    return users.filter(
      (entry) =>
        entry.userId.includes(needle) || entry.displayName.toLowerCase().includes(needle),
    )
  }, [users, query])

  const totalNotes = stats?.notes ?? 0

  if (!open) return null

  const openRow = (userId: string) => {
    setManaging((current) => (current === userId ? null : userId))
    setNextId('')
    setNextPin('')
    setActionError(null)
    setNotice(null)
  }

  const act = async (request: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setActionError(null)
    setNotice(null)
    try {
      await request()
    setNotice(message)
    requestAdmin()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'That action did not go through.')
    } finally {
      setBusy(false)
    }
  }

  const saveUserId = async (currentId: string) => {
    if (!token || nextId.length !== 8) {
      setActionError('The new ID must be exactly 8 digits.')
      return
    }
    setBusy(true)
    setActionError(null)
    setNotice(null)
    try {
      await api(`/api/admin/users/${currentId}/id`, {
        method: 'POST',
        token,
        body: { userId: nextId },
      })
      if (currentId === currentUserId) {
        window.location.reload()
        return
      }
      setNotice('ID updated. Tell them to sign in with the new number.')
      setNextId('')
      setManaging(null)
      requestAdmin()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not change that ID.')
    } finally {
      setBusy(false)
    }
  }

  const resetPin = async (targetId: string) => {
    if (!token || nextPin.length !== 6) {
      setActionError('The new PIN must be 6 digits.')
      return
    }
    await act(
      () =>
        api(`/api/admin/users/${targetId}/pin`, {
          method: 'POST',
          token,
          body: { pin: nextPin },
        }),
      'PIN reset. They are signed out everywhere and must use the new PIN.',
    )
    setNextPin('')
  }

  const removeAccount = async () => {
    if (!deleteTarget || !token) return
    setBusy(true)
    setActionError(null)
    setNotice(null)
    try {
      const result = await api<{ notesTransferred: number }>(
        `/api/admin/users/${deleteTarget.userId}`,
        { method: 'DELETE', token },
      )
      setNotice(
        `Account deleted. ${result.notesTransferred} ${
          result.notesTransferred === 1 ? 'note' : 'notes'
        } moved to you.`,
      )
      setDeleteTarget(null)
      setDeleteConfirm('')
      setManaging(null)
      requestAdmin()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not delete that account.')
    } finally {
      setBusy(false)
    }
  }

  const createAccount = async () => {
    if (!token) return
    const displayName = newName.trim()
    if (!displayName) {
      setCreateError('Enter a display name.')
      return
    }
    if (newPin.length !== 6) {
      setCreateError('Choose a 6-digit PIN.')
      return
    }
    if (newUserId && newUserId.length !== 8) {
      setCreateError('An ID has to be exactly 8 digits, or leave it blank.')
      return
    }
    setBusy(true)
    setCreateError(null)
    setActionError(null)
    setNotice(null)
    try {
      const result = await api<{
        user: { userId: string; displayName: string }
        generatedId: boolean
      }>('/api/admin/users', {
        method: 'POST',
        token,
        body: {
          displayName,
          pin: newPin,
          ...(newUserId ? { userId: newUserId } : {}),
        },
      })
      setCreateOpen(false)
      setNewName('')
      setNewUserId('')
      setNewPin('')
      setNotice(
        `Account ${result.user.userId} created for ${result.user.displayName}${
          result.generatedId ? ' with a generated ID' : ''
        }. Share that ID and PIN with them.`,
      )
      setManaging(result.user.userId)
      requestAdmin()
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create that account.')
    } finally {
      setBusy(false)
    }
  }

  const downloadBackup = async () => {
    if (!token) return
    setBackupBusy(true)
    setActionError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/admin/backup', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        let message = 'Could not create a backup.'
        try {
          const data = (await response.json()) as { error?: string }
          if (data?.error) message = data.error
        } catch {
          // Keep the generic message when the server sent something else.
        }
        throw new Error(message)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `quicky-notes-${new Date().toISOString().slice(0, 10)}.sqlite`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
      setNotice('Backup downloaded.')
      requestAdmin()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not create a backup.')
    } finally {
      setBackupBusy(false)
    }
  }

  return createPortal(
    <div className="admin" role="dialog" aria-modal="true" aria-label="Admin console">
      <header className="admin__bar">
        <button
          ref={backRef}
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label="Back to notes"
          title="Back to notes"
        >
          <ArrowLeftIcon size={18} />
        </button>
        <div className="admin__heading">
          <span className="eyebrow">Quicky Notes</span>
          <h1 className="admin__title">Admin console</h1>
        </div>
        <div className="admin__status">
          <ConnectionBadge
            status={status}
            synced={status === 'online'}
            onRetry={retry}
            compact
          />
          <div className="admin__stats" aria-live="polite">
            <span>
              <strong>{stats ? stats.accounts : '—'}</strong> accounts
            </span>
            <span>
              <strong>{stats ? totalNotes : '—'}</strong> notes
            </span>
            <span>
              <strong>{stats ? stats.sessions : '—'}</strong> sessions
            </span>
          </div>
        </div>
      </header>

      <main className="admin__main">
        <div className="admin__panel">
          <div className="admin__toolbar">
            <div className="admin__search">
              <SearchIcon size={16} />
              <input
                type="text"
                inputMode="search"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or 8-digit ID"
                aria-label="Search accounts"
              />
              {query ? (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                >
                  <XIcon size={14} />
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => {
                setCreateOpen(true)
                setCreateError(null)
              }}
              disabled={busy}
            >
              New account
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setLoading(true)
                requestAdmin()
              }}
              disabled={loading || status !== 'online'}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="admin-switch">
            <div className="admin-switch__text">
              <span className="admin-switch__label">New signups</span>
              <span className="admin-switch__hint">
                {stats?.signupsEnabled
                  ? 'Open — anyone can create an account with a PIN.'
                  : 'Closed — only existing accounts can sign in.'}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={stats?.signupsEnabled ?? false}
              aria-label="Allow new signups"
              className={`switch${stats?.signupsEnabled ? ' is-on' : ''}`}
              disabled={busy || !stats || !token}
              onClick={() => {
                if (!stats || !token) return
                void act(
                  () =>
                    api('/api/admin/signups', {
                      method: 'POST',
                      token,
                      body: { enabled: !stats.signupsEnabled },
                    }),
                  stats.signupsEnabled ? 'New signups are closed.' : 'New signups are open.',
                )
              }}
            >
              <span className="switch__thumb" />
            </button>
          </div>

          {stats ? (
            <>
              <div className="admin-ops">
                <div className="admin-op">
                  <span className="eyebrow">Accounts</span>
                  <strong>{stats.accounts}</strong>
                  <span className="admin-op__sub">
                    {stats.admins} admin{stats.admins === 1 ? '' : 's'} · {stats.suspended}{' '}
                    suspended
                  </span>
                </div>
                <div className="admin-op">
                  <span className="eyebrow">Notes</span>
                  <strong>{stats.notes}</strong>
                  <span className="admin-op__sub">across every account</span>
                </div>
                <div className="admin-op">
                  <span className="eyebrow">Sessions</span>
                  <strong>{stats.sessions}</strong>
                  <span className="admin-op__sub">signed in right now</span>
                </div>
                <div className="admin-op">
                  <span className="eyebrow">Live rooms</span>
                  <strong>{stats.rooms.rooms}</strong>
                  <span className="admin-op__sub">
                    {stats.rooms.connections} connection
                    {stats.rooms.connections === 1 ? '' : 's'} · {stats.rooms.noteRooms} notes
                  </span>
                </div>
                <div className="admin-op">
                  <span className="eyebrow">Database</span>
                  <strong>{formatBytes(stats.dbBytes)}</strong>
                  <span className="admin-op__sub">
                    v{stats.version} · node {stats.node}
                  </span>
                </div>
                <div className="admin-op">
                  <span className="eyebrow">Storage</span>
                  <strong>{stats.storage.persistent ? 'Persistent' : 'Ephemeral'}</strong>
                  <span className="admin-op__sub">
                    {stats.storage.persistent
                      ? 'Railway volume'
                      : stats.storage.onRailway
                        ? 'lost on redeploy'
                        : 'local disk'}
                  </span>
                </div>
                <div className="admin-op">
                  <span className="eyebrow">Uptime</span>
                  <strong>{formatUptime(stats.uptime)}</strong>
                  <span className="admin-op__sub">since the last restart</span>
                </div>
              </div>
              <div className="admin__ops-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void downloadBackup()}
                  disabled={backupBusy || !token}
                >
                  {backupBusy ? 'Preparing…' : 'Download backup'}
                </button>
              </div>
            </>
          ) : null}

          <p className="admin__hint">
            Changing an ID moves every note, session and share with it. Resetting a PIN signs that
            person out everywhere. Deleting an account moves their notes to you so shared notes
            survive.
          </p>

          {notice ? (
            <p className="admin__notice" role="status">
              {notice}
            </p>
          ) : null}
          {actionError ? (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          ) : null}

          <div className="admin-list admin-list--page">
            {users === null ? (
              <p className="admin__empty">
                {status === 'online'
                  ? 'Waiting for the live snapshot…'
                  : 'Connecting to the live server…'}
              </p>
            ) : null}
            {users !== null && filtered.length === 0 ? (
              <p className="admin__empty">
                {query.trim() ? `No accounts match “${query.trim()}”.` : 'No accounts yet.'}
              </p>
            ) : null}

            {filtered.map((entry) => {
              const self = entry.userId === currentUserId
              const suspended = entry.suspendedAt > 0
              const locked = entry.lockedUntil > now
              return (
                <article
                  key={entry.userId}
                  className={`admin-card${managing === entry.userId ? ' is-open' : ''}`}
                >
                  <header className="admin-card__head">
                    <div className="admin-card__who">
                      <span
                        className="avatar avatar--xs"
                        style={{ background: colorFor(entry.userId) }}
                        aria-hidden="true"
                      >
                        {initials(entry.displayName)}
                      </span>
                      <div className="admin-card__text">
                        <span className="admin-card__name">
                          {entry.displayName}
                          {entry.isAdmin ? <span className="badge">admin</span> : null}
                          {self ? <span className="badge badge--you">you</span> : null}
                          {suspended ? (
                            <span className="badge badge--suspended">suspended</span>
                          ) : null}
                          {locked ? <span className="badge badge--locked">locked</span> : null}
                        </span>
                        <span className="admin-card__meta mono">
                          {entry.userId} · {entry.noteCount}{' '}
                          {entry.noteCount === 1 ? 'note' : 'notes'} · {entry.sessionCount}{' '}
                          {entry.sessionCount === 1 ? 'session' : 'sessions'} · joined{' '}
                          {formatJoined(entry.createdAt)}
                        </span>
                        {entry.lastSeen ? (
                          <span className="admin-card__meta mono">
                            last seen {formatWhen(entry.lastSeen)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => openRow(entry.userId)}
                      aria-expanded={managing === entry.userId}
                    >
                      {managing === entry.userId ? 'Close' : 'Manage'}
                    </button>
                  </header>

                  {managing === entry.userId ? (
                    <div className="admin-card__tools">
                      <div className="admin-tool">
                        <span className="admin-tool__label">Change ID</span>
                        <div className="admin-tool__row">
                          <input
                            className="input input--mono"
                            inputMode="numeric"
                            maxLength={8}
                            placeholder="New 8-digit ID"
                            aria-label={`New ID for ${entry.displayName}`}
                            value={nextId}
                            onChange={(event) =>
                              setNextId(event.target.value.replace(/\D/g, '').slice(0, 8))
                            }
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
                      </div>
                      <div className="admin-tool">
                        <span className="admin-tool__label">Reset PIN</span>
                        <div className="admin-tool__row">
                          <input
                            className="input input--mono"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="New 6-digit PIN"
                            aria-label={`New PIN for ${entry.displayName}`}
                            value={nextPin}
                            onChange={(event) =>
                              setNextPin(event.target.value.replace(/\D/g, '').slice(0, 6))
                            }
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

                      <div className="admin-card__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy || (!locked && entry.failedAttempts === 0)}
                          onClick={() =>
                            void act(
                              () =>
                                api(`/api/admin/users/${entry.userId}/unlock`, {
                                  method: 'POST',
                                  token,
                                }),
                              `${entry.displayName} can try signing in again.`,
                            )
                          }
                        >
                          {locked ? 'Unlock now' : 'Clear failed tries'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy || entry.sessionCount === 0}
                          onClick={() =>
                            void act(
                              () =>
                                api(`/api/admin/users/${entry.userId}/sessions`, {
                                  method: 'POST',
                                  token,
                                }),
                              self
                                ? 'Your other devices were signed out.'
                                : `${entry.displayName} was signed out everywhere.`,
                            )
                          }
                        >
                          {self ? 'Sign out other devices' : 'Sign out everywhere'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy || self}
                          title={self ? 'You cannot suspend your own account.' : undefined}
                          onClick={() =>
                            void act(
                              () =>
                                api(`/api/admin/users/${entry.userId}/suspend`, {
                                  method: 'POST',
                                  token,
                                  body: { suspended: !suspended },
                                }),
                              suspended
                                ? `${entry.displayName} can sign in again.`
                                : `${entry.displayName} is suspended and signed out.`,
                            )
                          }
                        >
                          {suspended ? 'Restore access' : 'Suspend'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy || (entry.isAdmin && (self || (stats?.admins ?? 0) <= 1))}
                          title={
                            entry.isAdmin && self
                              ? 'You cannot remove your own admin access.'
                              : entry.isAdmin && (stats?.admins ?? 0) <= 1
                                ? 'Keep at least one admin.'
                                : undefined
                          }
                          onClick={() =>
                            void act(
                              () =>
                                api(`/api/admin/users/${entry.userId}/role`, {
                                  method: 'POST',
                                  token,
                                  body: { isAdmin: !entry.isAdmin },
                                }),
                              entry.isAdmin
                                ? `${entry.displayName} is no longer an admin.`
                                : `${entry.displayName} is now an admin.`,
                            )
                          }
                        >
                          {entry.isAdmin ? 'Remove admin' : 'Make admin'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm btn--danger-ghost"
                          disabled={busy || self}
                          title={self ? 'You cannot delete your own account.' : undefined}
                          onClick={() => {
                            setDeleteTarget(entry)
                            setDeleteConfirm('')
                          }}
                        >
                          Delete…
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>

          <section className="admin__section">
            <div className="admin__section-head">
              <h2 className="admin__section-title">Recent admin activity</h2>
              <span className="eyebrow">Last 40 actions</span>
            </div>
            {audit.length === 0 ? (
              <p className="admin__empty">No admin actions yet.</p>
            ) : (
              <ul className="audit">
                {audit.map((entry) => (
                  <li key={entry.id} className="audit__row">
                    <span className="audit__text">{auditText(entry)}</span>
                    <span className="audit__time mono">{formatWhen(entry.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      <Modal
        open={createOpen}
        title="Create an account"
        size="sm"
        onClose={() => {
          setCreateOpen(false)
          setCreateError(null)
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setCreateOpen(false)
                setCreateError(null)
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => void createAccount()}
            >
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </>
        }
      >
        <p className="modal__lede">
          Set a name and PIN for the person. Leave the ID blank and we will generate one, or choose
          their 8-digit ID if they already have a number in mind.
        </p>
        <label className="field">
          <span>Display name</span>
          <input
            value={newName}
            maxLength={40}
            autoComplete="off"
            placeholder="Grace"
            onChange={(event) => {
              setNewName(event.target.value)
              setCreateError(null)
            }}
          />
        </label>
        <label className="field">
          <span>User ID (optional)</span>
          <input
            className="input--mono"
            inputMode="numeric"
            maxLength={8}
            autoComplete="off"
            placeholder="Leave blank to generate"
            value={newUserId}
            onChange={(event) => {
              setNewUserId(event.target.value.replace(/\D/g, '').slice(0, 8))
              setCreateError(null)
            }}
          />
        </label>
        <label className="field">
          <span>6-digit PIN</span>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="new-password"
            placeholder="••••••"
            value={newPin}
            onChange={(event) => {
              setNewPin(event.target.value.replace(/\D/g, '').slice(0, 6))
              setCreateError(null)
            }}
          />
        </label>
        {createError ? (
          <p className="form-error" role="alert">
            {createError}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={!!deleteTarget}
        title="Delete this account?"
        size="sm"
        onClose={() => {
          setDeleteTarget(null)
          setDeleteConfirm('')
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setDeleteTarget(null)
                setDeleteConfirm('')
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy || deleteConfirm !== deleteTarget?.userId}
              onClick={() => void removeAccount()}
            >
              Delete account
            </button>
          </>
        }
      >
        <p className="modal__lede">
          This signs {deleteTarget?.displayName ?? 'this person'} out for good and removes their
          account. Their {deleteTarget?.noteCount ?? 0}{' '}
          {deleteTarget?.noteCount === 1 ? 'note moves' : 'notes move'} to you — everyone they shared
          with keeps access.
        </p>
        <label className="field">
          <span>Type {deleteTarget?.userId} to confirm</span>
          <input
            className="input input--mono"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={deleteConfirm}
            aria-label="Type the account ID to confirm"
            onChange={(event) => setDeleteConfirm(event.target.value.replace(/\D/g, '').slice(0, 8))}
          />
        </label>
      </Modal>
    </div>,
    document.body,
  )
}
