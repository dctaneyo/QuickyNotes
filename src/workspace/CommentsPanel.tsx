import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../components/Modal'
import { CheckIcon, TrashIcon } from '../components/Icons'
import { colorFor, formatTime, initials } from '../lib/notes'
import type { Member, NoteComment } from '../lib/types'

interface CommentsPanelProps {
  open: boolean
  onClose: () => void
  noteTitle: string
  comments: NoteComment[]
  members: Member[] | null
  currentUserId: string
  isOwner: boolean
  loading: boolean
  error: string | null
  busy: boolean
  onAdd: (body: string, mentions: string[]) => Promise<unknown>
  onResolve: (id: string, resolved: boolean) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function CommentBody({ comment }: { comment: NoteComment }) {
  const names = comment.mentions.map((mention) => mention.displayName).filter(Boolean)
  if (names.length === 0) return <>{comment.body}</>
  const pattern = new RegExp(`(@(?:${names.map(escapeRegExp).join('|')}))`, 'g')
  return (
    <>
      {comment.body.split(pattern).map((part, index) =>
        part.startsWith('@') ? (
          <mark className="comment-mention" key={index}>
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  )
}

export function CommentsPanel({
  open,
  onClose,
  noteTitle,
  comments,
  members,
  currentUserId,
  isOwner,
  loading,
  error,
  busy,
  onAdd,
  onResolve,
  onDelete,
  onRefresh,
}: CommentsPanelProps) {
  const [body, setBody] = useState('')
  const [selectedMentions, setSelectedMentions] = useState<string[]>([])
  const [localError, setLocalError] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  useEffect(() => {
    if (!open) {
      setBody('')
      setSelectedMentions([])
      setLocalError(null)
      setShowResolved(false)
    }
  }, [open])

  const mentionCandidates = useMemo(
    () => (members ?? []).filter((member) => member.userId !== currentUserId),
    [members, currentUserId],
  )
  const visible = comments.filter((comment) => showResolved || !comment.resolvedAt)
  const resolvedCount = comments.filter((comment) => comment.resolvedAt).length

  const submit = async () => {
    const text = body.trim()
    if (!text) {
      setLocalError('Write a comment first.')
      return
    }
    setLocalError(null)
    try {
      await onAdd(text, selectedMentions)
      setBody('')
      setSelectedMentions([])
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Could not post this comment.')
    }
  }

  return (
    <Modal open={open} title="Comments" onClose={onClose} size="md">
      <div className="comments">
        <div className="comments__intro">
          <p className="modal__lede">
            Talk about <strong>{noteTitle || 'this note'}</strong> without changing the writing.
            Mention someone to put it in their inbox.
          </p>
          {resolvedCount > 0 ? (
            <button
              type="button"
              className="link link--tiny"
              onClick={() => setShowResolved((value) => !value)}
            >
              {showResolved ? 'Hide resolved' : `Show ${resolvedCount} resolved`}
            </button>
          ) : null}
        </div>

        {localError || error ? (
          <p className="form-error" role="alert">
            {localError ?? error}
          </p>
        ) : null}

        <div className="comments__list">
          {loading ? <p className="muted">Loading comments…</p> : null}
          {!loading && visible.length === 0 ? (
            <div className="comments__empty">
              <p>No comments yet.</p>
              <span>Start a conversation about this note.</span>
            </div>
          ) : null}
          {visible.map((comment) => (
            <article
              key={comment.id}
              className={`comment${comment.resolvedAt ? ' is-resolved' : ''}`}
            >
              <div className="comment__head">
                <span
                  className="avatar avatar--xs"
                  style={{ background: colorFor(comment.authorId) }}
                  aria-hidden="true"
                >
                  {initials(comment.authorName)}
                </span>
                <span className="comment__author">{comment.authorName}</span>
                <span className="comment__time" title={formatTime(comment.createdAt)}>
                  {relativeTime(comment.createdAt)}
                </span>
                {comment.resolvedAt ? <span className="comment__resolved">Resolved</span> : null}
                <span className="comment__actions">
                  {(isOwner || comment.authorId === currentUserId) && !comment.resolvedAt ? (
                    <button
                      type="button"
                      className="icon-btn icon-btn--tiny"
                      onClick={() => void onResolve(comment.id, true)}
                      aria-label="Resolve comment"
                      title="Resolve"
                    >
                      <CheckIcon size={14} />
                    </button>
                  ) : null}
                  {(isOwner || comment.authorId === currentUserId) && comment.resolvedAt ? (
                    <button
                      type="button"
                      className="link link--tiny"
                      onClick={() => void onResolve(comment.id, false)}
                    >
                      Reopen
                    </button>
                  ) : null}
                  {isOwner || comment.authorId === currentUserId ? (
                    <button
                      type="button"
                      className="icon-btn icon-btn--tiny icon-btn--danger"
                      onClick={() => void onDelete(comment.id)}
                      aria-label="Delete comment"
                      title="Delete"
                    >
                      <TrashIcon size={14} />
                    </button>
                  ) : null}
                </span>
              </div>
              <p className="comment__body">
                <CommentBody comment={comment} />
              </p>
              {comment.mentions.length > 0 ? (
                <div className="comment__mentions">
                  {comment.mentions.map((mention) => (
                    <span key={mention.userId} className="tag tag--sm">
                      @{mention.displayName}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <div className="comment-compose">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Leave a thoughtful comment…"
            aria-label="Write a comment"
            rows={3}
            maxLength={4000}
          />
          {mentionCandidates.length > 0 ? (
            <div className="comment-compose__mentions" aria-label="Mention someone">
              <span className="eyebrow">Mention</span>
              {mentionCandidates.slice(0, 8).map((member) => (
                <button
                  key={member.userId}
                  type="button"
                  className={`mention-pill${
                    selectedMentions.includes(member.userId) ? ' is-selected' : ''
                  }`}
                  onClick={() =>
                    setSelectedMentions((previous) =>
                      previous.includes(member.userId)
                        ? previous.filter((id) => id !== member.userId)
                        : [...previous, member.userId],
                    )
                  }
                  aria-pressed={selectedMentions.includes(member.userId)}
                >
                  @{member.displayName}
                </button>
              ))}
            </div>
          ) : null}
          <div className="comment-compose__foot">
            <span className="muted">{body.length}/4000</span>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void submit()}
              disabled={busy || !body.trim()}
            >
              {busy ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </div>

        {error ? (
          <button type="button" className="link link--tiny" onClick={onRefresh}>
            Try loading comments again
          </button>
        ) : null}
      </div>
    </Modal>
  )
}
