import { useEffect } from 'react'
import { Modal } from '../components/Modal'
import { colorFor, initials } from '../lib/notes'
import type { MentionItem, NoteSummary } from '../lib/types'

interface MentionsDialogProps {
  open: boolean
  onClose: () => void
  mentions: MentionItem[]
  notes: NoteSummary[]
  loading: boolean
  error: string | null
  onOpenNote: (id: string) => void
  onMarkRead: () => Promise<void>
  onRefresh: () => void
}

function relativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp)
  if (diff < 45_000) return 'just now'
  const minutes = Math.round(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function MentionsDialog({
  open,
  onClose,
  mentions,
  notes,
  loading,
  error,
  onOpenNote,
  onMarkRead,
  onRefresh,
}: MentionsDialogProps) {
  useEffect(() => {
    if (!open) return
    void onMarkRead().catch(() => undefined)
  }, [open, onMarkRead])

  return (
    <Modal open={open} title="Notifications" onClose={onClose} size="sm">
      <p className="modal__lede">
        New comments on notes you can access. Comments appear here even when nobody mentions you;
        @mentions are highlighted inside the comment.
      </p>
      {error ? (
        <div className="comments__empty" role="alert">
          <p>{error}</p>
          <button type="button" className="link link--tiny" onClick={onRefresh}>
            Try again
          </button>
        </div>
      ) : null}
      {loading ? <p className="muted">Loading notifications…</p> : null}
      {!loading && !error && mentions.length === 0 ? (
        <div className="comments__empty">
          <p>No notifications yet.</p>
          <span>New comments on your shared notes appear here, whether or not you were mentioned.</span>
        </div>
      ) : null}
      <div className="mentions-list">
        {mentions.map((mention) => {
          const note = notes.find((candidate) => candidate.id === mention.noteId)
          return (
            <button
              key={mention.id}
              type="button"
              className={`mention-item${mention.readAt ? '' : ' is-unread'}`}
              onClick={() => onOpenNote(mention.noteId)}
            >
              <span
                className="avatar avatar--xs"
                style={{ background: colorFor(mention.authorId) }}
                aria-hidden="true"
              >
                {initials(mention.authorName)}
              </span>
              <span className="mention-item__main">
                <span className="mention-item__top">
                  <strong>{mention.authorName}</strong>
                  <span>{relativeTime(mention.createdAt)}</span>
                </span>
                <span className="mention-item__note">
                  <span>{note?.title || mention.noteTitle || 'A note'}</span>
                  <span
                    className={`mention-item__kind${mention.mentioned ? ' is-mention' : ''}`}
                  >
                    {mention.mentioned ? 'Mentioned you' : 'New comment'}
                  </span>
                </span>
                <span className="mention-item__body">{mention.body}</span>
              </span>
              {!mention.readAt ? <span className="mention-item__dot" aria-label="Unread" /> : null}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
