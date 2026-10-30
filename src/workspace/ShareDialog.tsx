import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { TrashIcon } from '../components/Icons'
import { api } from '../lib/api'
import { colorFor, initials } from '../lib/notes'
import type { Member, NoteSummary, Role } from '../lib/types'

interface UserResult {
  userId: string
  displayName: string
}

interface ShareDialogProps {
  open: boolean
  onClose: () => void
  note: NoteSummary
  members: Member[] | null
  loading: boolean
  error: string | null
  currentUserId: string
  token: string | null
  onInvite: (userId: string, role: Exclude<Role, 'owner'>) => Promise<void>
  onChangeRole: (userId: string, role: Exclude<Role, 'owner'>) => Promise<void>
  onTogglePublic: (enabled: boolean) => Promise<void>
  onRemove: (userId: string) => Promise<void>
  onLeave: () => Promise<void>
}

export function ShareDialog({
  open,
  onClose,
  note,
  members,
  loading,
  error,
  currentUserId,
  token,
  onInvite,
  onChangeRole,
  onTogglePublic,
  onRemove,
  onLeave,
}: ShareDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserResult[]>([])
  const [searching, setSearching] = useState(false)
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('editor')
  const [publicBusy, setPublicBusy] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const isOwner = note.role === 'owner'
  const publicUrl = note.publicToken ? `${window.location.origin}/p/${note.publicToken}` : null
  const trimmed = query.trim()

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setActive(-1)
      setSearching(false)
      setRole('editor')
      setPublicBusy(false)
      setCopyMessage(null)
      setLocalError(null)
      setBusy(false)
    }
  }, [open])

  useEffect(() => {
    if (!open || !isOwner || !token) return
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const timer = window.setTimeout(() => {
      api<{ users: UserResult[] }>(`/api/users/search?q=${encodeURIComponent(trimmed)}`, {
        token,
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) setResults(result.users)
        })
        .catch((caught: unknown) => {
          if ((caught as Error)?.name === 'AbortError') return
          if (!controller.signal.aborted) setResults([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 220)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, isOwner, token, trimmed])

  const memberIds = new Set((members ?? []).map((member) => member.userId))
  const matches = results.filter(
    (entry) => entry.userId !== currentUserId && !memberIds.has(entry.userId),
  )

  const invite = async (candidate: string) => {
    if (busy) return
    const userId = candidate.trim()
    if (!/^\d{8}$/.test(userId)) {
      setLocalError('Pick someone from the list, or type their 8-digit ID.')
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      await onInvite(userId, role)
      setQuery('')
      setResults([])
      setActive(-1)
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Could not invite that person.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Share this note" onClose={onClose} size="sm">
      <p className="modal__lede">
        Invite people by name or 8-digit ID. Editors write together in realtime; viewers can read
        and comment without changing the note.
      </p>

      {isOwner ? (
        <>
          <div className="invite">
            <input
              className="input"
              type="text"
              placeholder="Name or 8-digit ID"
              value={query}
              maxLength={40}
              autoComplete="off"
              role="combobox"
              aria-expanded={matches.length > 0}
              aria-autocomplete="list"
              aria-controls="share-results"
              aria-label="Find someone by name or user ID"
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(-1)
                setLocalError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  if (matches.length > 0) {
                    setActive((index) => Math.min(index + 1, matches.length - 1))
                  }
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive((index) => Math.max(index - 1, -1))
                  return
                }
                if (event.key === 'Escape') {
                  setResults([])
                  setActive(-1)
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void invite(active >= 0 && matches[active] ? matches[active].userId : trimmed)
                }
              }}
            />
            <select
              className="input share-role"
              value={role}
              onChange={(event) => setRole(event.target.value === 'viewer' ? 'viewer' : 'editor')}
              aria-label="Role for invited person"
            >
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </select>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() =>
                void invite(active >= 0 && matches[active] ? matches[active].userId : trimmed)
              }
              disabled={busy}
            >
              {busy ? 'Inviting…' : 'Invite'}
            </button>
          </div>

          {searching ? <p className="muted search-status">Searching…</p> : null}
          {matches.length > 0 ? (
            <div className="share-results" id="share-results" role="listbox" aria-label="Matching people">
              {matches.map((entry, index) => (
                <button
                  key={entry.userId}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`share-result${index === active ? ' is-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => void invite(entry.userId)}
                >
                  <span
                    className="avatar avatar--xs"
                    style={{ background: colorFor(entry.userId) }}
                    aria-hidden="true"
                  >
                    {initials(entry.displayName)}
                  </span>
                  <span className="share-result__text">
                    <span className="share-result__name">{entry.displayName}</span>
                    <span className="share-result__id mono">{entry.userId}</span>
                  </span>
                  <span className="share-result__add">Invite</span>
                </button>
              ))}
            </div>
          ) : null}
          {!searching && trimmed.length >= 2 && matches.length === 0 ? (
            <p className="muted search-status">
              No one matches “{trimmed}” yet. You can still invite an exact 8-digit ID.
            </p>
          ) : null}
        </>
      ) : null}

      {localError || error ? (
        <p className="form-error" role="alert">
          {localError ?? error}
        </p>
      ) : null}

      <div className="members">
        {loading ? <p className="muted">Loading people…</p> : null}
        {!loading && members && members.length === 0 ? (
          <p className="muted">Only you, for now.</p>
        ) : null}
        {members?.map((member) => (
          <div key={member.userId} className="member">
            <span className="avatar" style={{ background: colorFor(member.userId) }}>
              {initials(member.displayName)}
            </span>
            <div className="member__text">
              <span className="member__name">
                {member.displayName}
                {member.userId === currentUserId ? ' (you)' : ''}
              </span>
              <span className="member__id mono">{member.userId}</span>
            </div>
            {isOwner && member.role !== 'owner' ? (
              <select
                className="input member__role member__role-select"
                value={member.role === 'viewer' ? 'viewer' : 'editor'}
                onChange={(event) => {
                  const nextRole = event.target.value === 'viewer' ? 'viewer' : 'editor'
                  setLocalError(null)
                  void onChangeRole(member.userId, nextRole).catch((caught) => {
                    setLocalError(
                      caught instanceof Error ? caught.message : 'Could not change that role.',
                    )
                  })
                }}
                aria-label={`Role for ${member.displayName}`}
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            ) : (
              <span className="member__role">{member.role}</span>
            )}
            {isOwner && member.role !== 'owner' ? (
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                onClick={() => void onRemove(member.userId)}
                aria-label={`Remove ${member.displayName}`}
                title="Remove"
              >
                <TrashIcon size={16} />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {isOwner ? (
        <section className="public-share">
          <div className="public-share__head">
            <div>
              <h3>Public read-only link</h3>
              <p className="muted">
                Anyone with the link can read this note. They cannot edit, comment or see other
                notes.
              </p>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={publicBusy}
              onClick={async () => {
                setPublicBusy(true)
                setLocalError(null)
                try {
                  await onTogglePublic(!publicUrl)
                } catch (caught) {
                  setLocalError(
                    caught instanceof Error ? caught.message : 'Could not update the public link.',
                  )
                } finally {
                  setPublicBusy(false)
                }
              }}
            >
              {publicBusy ? 'Updating…' : publicUrl ? 'Turn off link' : 'Create link'}
            </button>
          </div>
          {publicUrl ? (
            <div className="public-share__link">
              <input className="input" readOnly value={publicUrl} aria-label="Public note link" />
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  if (!navigator.clipboard?.writeText) {
                    setCopyMessage('Select the link above to copy it')
                    return
                  }
                  void navigator.clipboard
                    .writeText(publicUrl)
                    .then(() => setCopyMessage('Copied'))
                    .catch(() => setCopyMessage('Select the link above to copy it'))
                }}
              >
                Copy
              </button>
            </div>
          ) : null}
          {copyMessage ? <p className="muted">{copyMessage}</p> : null}
        </section>
      ) : null}

      {!isOwner ? (
        <button type="button" className="btn btn--ghost btn--full" onClick={() => void onLeave()}>
          Leave this note
        </button>
      ) : null}
    </Modal>
  )
}
