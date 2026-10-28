import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { TrashIcon } from '../components/Icons'
import { colorFor, initials } from '../lib/notes'
import type { Member, NoteSummary } from '../lib/types'

interface ShareDialogProps {
  open: boolean
  onClose: () => void
  note: NoteSummary
  members: Member[] | null
  loading: boolean
  error: string | null
  currentUserId: string
  onInvite: (userId: string) => Promise<void>
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
  onInvite,
  onRemove,
  onLeave,
}: ShareDialogProps) {
  const [inviteId, setInviteId] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setInviteId('')
      setLocalError(null)
      setBusy(false)
    }
  }, [open])

  const isOwner = note.role === 'owner'

  const invite = async () => {
    if (inviteId.trim().length !== 8 || busy) {
      setLocalError('Enter the 8-digit ID of the person you want to invite.')
      return
    }
    setBusy(true)
    setLocalError(null)
    try {
      await onInvite(inviteId.trim())
      setInviteId('')
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Could not invite that person.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="Share this note" onClose={onClose} size="sm">
      <p className="modal__lede">
        Everyone listed here can open and edit this note at the same time. Invite people with their
        8-digit ID.
      </p>

      {isOwner ? (
        <div className="invite">
          <input
            className="input input--mono"
            inputMode="numeric"
            placeholder="8-digit ID"
            value={inviteId}
            maxLength={8}
            aria-label="Collaborator user ID"
            onChange={(event) => {
              setInviteId(event.target.value.replace(/\D/g, '').slice(0, 8))
              setLocalError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void invite()
            }}
          />
          <button type="button" className="btn btn--primary" onClick={invite} disabled={busy}>
            {busy ? 'Inviting…' : 'Invite'}
          </button>
        </div>
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
            <span className="member__role">{member.role}</span>
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

      {!isOwner ? (
        <button type="button" className="btn btn--ghost btn--full" onClick={() => void onLeave()}>
          Leave this note
        </button>
      ) : null}
    </Modal>
  )
}
