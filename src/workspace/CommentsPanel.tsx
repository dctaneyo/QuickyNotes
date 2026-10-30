import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Modal } from '../components/Modal'
import { CheckIcon, TrashIcon } from '../components/Icons'
import { api } from '../lib/api'
import { colorFor, formatTime, initials } from '../lib/notes'
import type { Member, NoteComment, Role } from '../lib/types'

interface CommentsPanelProps {
  open: boolean
  onClose: () => void
  noteTitle: string
  comments: NoteComment[]
  members: Member[] | null
  currentUserId: string
  isOwner: boolean
  token: string | null
  loading: boolean
  error: string | null
  busy: boolean
  onAdd: (body: string, mentions: string[]) => Promise<unknown>
  onInvite: (userId: string, role: Exclude<Role, 'owner'>) => Promise<unknown>
  onResolve: (id: string, resolved: boolean) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
  onRefresh: () => void
}

interface MentionCandidate {
  userId: string
  displayName: string
  role: Role | null
}

interface MentionQuery {
  query: string
  start: number
  end: number
  active: number
}

interface PendingInvite {
  candidate: MentionCandidate
  start: number
  end: number
}

interface UserResult {
  userId: string
  displayName: string
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

function roleLabel(role: Role): string {
  if (role === 'owner') return 'Owner'
  if (role === 'editor') return 'Editor'
  return 'Viewer'
}

function mentionQueryAt(value: string, caret: number): Omit<MentionQuery, 'active'> | null {
  const before = value.slice(0, caret)
  const match = before.match(/(?:^|[\s([{])@([^\s@,.;:!?()[\]{}]*)$/)
  if (!match) return null
  return {
    query: match[1],
    start: caret - match[1].length - 1,
    end: caret,
  }
}

/** A deleted or edited @name should stop notifying that person. */
function containsMention(value: string, displayName: string): boolean {
  const token = `@${displayName}`
  let from = 0
  while (from < value.length) {
    const at = value.indexOf(token, from)
    if (at === -1) return false
    const after = value[at + token.length]
    if (!after || !/[\p{L}\p{N}_]/u.test(after)) return true
    from = at + 1
  }
  return false
}

function CommentBody({ comment }: { comment: NoteComment }) {
  const names = [...new Set(comment.mentions.map((mention) => mention.displayName).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
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
  token,
  loading,
  error,
  busy,
  onAdd,
  onInvite,
  onResolve,
  onDelete,
  onRefresh,
}: CommentsPanelProps) {
  const [body, setBody] = useState('')
  const [selectedMentions, setSelectedMentions] = useState<
    { userId: string; displayName: string }[]
  >([])
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null)
  const [userResults, setUserResults] = useState<UserResult[]>([])
  const [searching, setSearching] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setBody('')
      setSelectedMentions([])
      setMentionQuery(null)
      setPendingInvite(null)
      setUserResults([])
      setSearching(false)
      setInviteBusy(false)
      setLocalError(null)
      setShowResolved(false)
    }
  }, [open])

  const noteMembers = useMemo(
    () =>
      (members ?? [])
        .filter((member) => member.userId !== currentUserId)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [members, currentUserId],
  )
  const noteMemberIds = useMemo(
    () => new Set(noteMembers.map((member) => member.userId)),
    [noteMembers],
  )
  const searchTerm = mentionQuery?.query.trim() ?? ''
  const lowerQuery = searchTerm.toLowerCase()
  const menuOpen = mentionQuery !== null

  useEffect(() => {
    if (!open || !isOwner || !token || searchTerm.length < 2) {
      setUserResults([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setUserResults([])
    setSearching(true)
    const timer = window.setTimeout(() => {
      api<{ users: UserResult[] }>(`/api/users/search?q=${encodeURIComponent(searchTerm)}`, {
        token,
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) setUserResults(result.users)
        })
        .catch((caught: unknown) => {
          if ((caught as Error)?.name === 'AbortError') return
          if (!controller.signal.aborted) setUserResults([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, 180)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, isOwner, token, searchTerm])

  useEffect(() => {
    if (!menuOpen) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !composerRef.current?.contains(target)) {
        setMentionQuery(null)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [menuOpen])

  const candidates = useMemo(() => {
    const matches: MentionCandidate[] = []
    for (const member of noteMembers) {
      if (!lowerQuery || member.displayName.toLowerCase().includes(lowerQuery)) {
        matches.push({ ...member, role: member.role })
      }
      if (matches.length >= 8) break
    }
    if (isOwner && lowerQuery.length >= 2) {
      for (const user of userResults) {
        if (noteMemberIds.has(user.userId) || user.userId === currentUserId) continue
        matches.push({ ...user, role: null })
        if (matches.length >= 8) break
      }
    }
    return matches
  }, [noteMembers, lowerQuery, isOwner, userResults, noteMemberIds, currentUserId])

  const visible = comments.filter((comment) => showResolved || !comment.resolvedAt)
  const resolvedCount = comments.filter((comment) => comment.resolvedAt).length
  const activeIndex =
    mentionQuery && candidates.length > 0
      ? Math.min(Math.max(mentionQuery.active, 0), candidates.length - 1)
      : 0

  const syncComposer = (value: string, caret: number) => {
    setBody(value)
    setSelectedMentions((previous) =>
      previous.filter((mention) => containsMention(value, mention.displayName)),
    )
    setPendingInvite(null)
    const next = mentionQueryAt(value, caret)
    setMentionQuery(next ? { ...next, active: 0 } : null)
  }

  const insertMention = (candidate: MentionCandidate, start: number, end: number) => {
    const token = `@${candidate.displayName}`
    const nextBody = `${body.slice(0, start)}${token} ${body.slice(end)}`
    setBody(nextBody)
    setSelectedMentions((previous) => [
      ...previous.filter((mention) => mention.userId !== candidate.userId),
      { userId: candidate.userId, displayName: candidate.displayName },
    ])
    setMentionQuery(null)
    setPendingInvite(null)
    setLocalError(null)
    const caret = start + token.length + 1
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(caret, caret)
    })
  }

  const chooseCandidate = (candidate: MentionCandidate) => {
    if (!mentionQuery) return
    if (!candidate.role) {
      setPendingInvite({
        candidate,
        start: mentionQuery.start,
        end: mentionQuery.end,
      })
      setMentionQuery(null)
      setLocalError(null)
      return
    }
    insertMention(candidate, mentionQuery.start, mentionQuery.end)
  }

  const confirmInvite = async (role: Exclude<Role, 'owner'>) => {
    if (!pendingInvite || inviteBusy) return
    setInviteBusy(true)
    setLocalError(null)
    try {
      await onInvite(pendingInvite.candidate.userId, role)
      insertMention(pendingInvite.candidate, pendingInvite.start, pendingInvite.end)
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Could not add that person.')
    } finally {
      setInviteBusy(false)
    }
  }

  const cancelInvite = () => {
    const pending = pendingInvite
    setPendingInvite(null)
    if (!pending) return
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(pending.end, pending.end)
    })
  }

  const submit = async () => {
    const text = body.trim()
    if (!text) {
      setLocalError('Write a comment first.')
      return
    }
    if (pendingInvite) {
      setLocalError('Add that person to the note, or cancel, before posting.')
      return
    }
    setLocalError(null)
    try {
      await onAdd(
        text,
        selectedMentions.map((mention) => mention.userId),
      )
      setBody('')
      setSelectedMentions([])
      setMentionQuery(null)
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Could not post this comment.')
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && mentionQuery) {
      event.preventDefault()
      event.stopPropagation()
      setMentionQuery(null)
      return
    }
    if (!mentionQuery) return
    if (event.key === 'ArrowDown' && candidates.length > 0) {
      event.preventDefault()
      setMentionQuery((current) =>
        current ? { ...current, active: (activeIndex + 1) % candidates.length } : null,
      )
      return
    }
    if (event.key === 'ArrowUp' && candidates.length > 0) {
      event.preventDefault()
      setMentionQuery((current) =>
        current
          ? { ...current, active: (activeIndex - 1 + candidates.length) % candidates.length }
          : null,
      )
      return
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && candidates.length > 0) {
      event.preventDefault()
      chooseCandidate(candidates[activeIndex])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setMentionQuery(null)
    }
  }

  return (
    <Modal open={open} title="Comments" onClose={onClose} size="md">
      <div className="comments">
        <div className="comments__intro">
          <p className="modal__lede">
            Talk about <strong>{noteTitle || 'this note'}</strong> without changing the writing.
            Type @ to mention someone and put it in their inbox.
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
          <div className="comment-compose__editor" ref={composerRef}>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(event) => {
                const target = event.currentTarget
                syncComposer(target.value, target.selectionStart ?? target.value.length)
              }}
              onKeyDown={onComposerKeyDown}
              placeholder="Leave a thoughtful comment… Type @ to mention someone."
              aria-label="Write a comment"
              aria-autocomplete="list"
              aria-expanded={mentionQuery !== null}
              aria-controls="comment-mention-options"
              aria-activedescendant={
                mentionQuery && candidates[activeIndex]
                  ? `comment-mention-${candidates[activeIndex].userId}`
                  : undefined
              }
              rows={3}
              maxLength={4000}
            />
            {mentionQuery ? (
              <div
                className="mention-menu"
                id="comment-mention-options"
                role="listbox"
                aria-label="Mention suggestions"
              >
                <div className="mention-menu__head">
                  <span>{searchTerm ? 'People' : 'On this note'}</span>
                  {searching ? <span>Searching…</span> : null}
                </div>
                {candidates.map((candidate, index) => (
                  <button
                    key={candidate.userId}
                    type="button"
                    id={`comment-mention-${candidate.userId}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`mention-option${index === activeIndex ? ' is-active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() =>
                      setMentionQuery((current) =>
                        current ? { ...current, active: index } : null,
                      )
                    }
                    onClick={() => chooseCandidate(candidate)}
                  >
                    <span
                      className="avatar avatar--xs"
                      style={{ background: colorFor(candidate.userId) }}
                      aria-hidden="true"
                    >
                      {initials(candidate.displayName)}
                    </span>
                    <span className="mention-option__text">
                      <span className="mention-option__name">{candidate.displayName}</span>
                      <span className="mention-option__meta">
                        {candidate.role ? roleLabel(candidate.role) : 'Not on this note'}
                      </span>
                    </span>
                    <span className="mention-option__action">
                      {candidate.role ? 'Mention' : 'Add & mention'}
                    </span>
                  </button>
                ))}
                {candidates.length === 0 ? (
                  <p className="mention-menu__empty">
                    {searching
                      ? 'Searching everyone…'
                      : !isOwner && searchTerm.length >= 2
                        ? 'No one on this note matches. Only the note owner can invite new people.'
                        : noteMembers.length === 0
                          ? 'No one else is on this note yet.'
                          : searchTerm
                            ? 'No matching people.'
                            : 'Type a name to find someone.'}
                  </p>
                ) : null}
                {isOwner && searchTerm.length < 2 ? (
                  <p className="mention-menu__hint">Type 2 letters to search everyone.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          {pendingInvite ? (
            <div
              className="mention-invite"
              role="dialog"
              aria-label={`Add ${pendingInvite.candidate.displayName} to this note`}
            >
              <p className="mention-invite__copy">
                <strong>{pendingInvite.candidate.displayName}</strong> isn&apos;t on this note yet.
                Add them to mention them.
              </p>
              <div className="mention-invite__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void confirmInvite('viewer')}
                  disabled={inviteBusy}
                >
                  {inviteBusy ? 'Adding…' : 'Add as viewer'}
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => void confirmInvite('editor')}
                  disabled={inviteBusy}
                >
                  {inviteBusy ? 'Adding…' : 'Add as editor'}
                </button>
                <button
                  type="button"
                  className="link link--tiny"
                  onClick={cancelInvite}
                  disabled={inviteBusy}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className="comment-compose__foot">
            <span className="muted">{body.length}/4000</span>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void submit()}
              disabled={busy || inviteBusy || !!pendingInvite || !body.trim()}
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
