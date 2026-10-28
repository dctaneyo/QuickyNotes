import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import * as Y from 'yjs'
import type { Member, NoteSummary, SyncState } from '../lib/types'
import {
  BLOCK_LABELS,
  dateKey,
  dayLabel,
  formatDayShort,
  formatTime,
  initials,
  normalizeTag,
  noteDay,
} from '../lib/notes'
import {
  applyBlockFormat,
  blockArray,
  blockTextNode,
  blockView,
  blockViews,
  clearBlockFormat,
  createBlock,
  deleteBlock,
  moveBlock,
  noteMeta,
  patchMeta,
  plainText,
} from '../sync/noteModel'
import type { BlockFormat } from '../lib/formatting'
import type { Peer } from '../sync/useNoteSync'
import type { Realtime } from '../sync/useEvents'
import { SUGGESTED_TAGS } from '../lib/tags'
import type { TemplateDraft } from '../lib/templates'
import {
  BlockRow,
  type BlockRowApi,
  type FocusRequest,
  type RemoteCursor,
  type SlashState,
} from './BlockRow'
import { SlashMenu, filterSlash } from './SlashMenu'
import {
  FormatMenu,
  type FormatAnchor,
  type FormatMode,
  type FormatPlacement,
} from './FormatMenu'
import { Calendar } from './Calendar'
import { SaveTemplateDialog } from './SaveTemplateDialog'
import { LockNoteDialog, UnlockNoteDialog } from './NoteLockDialog'
import { NoteHistoryView } from './NoteHistoryView'
import { useNoteHistory } from '../hooks/useNoteHistory'
import { ConnectionBadge } from '../components/ConnectionBadge'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  CalendarIcon,
  DotsIcon,
  HistoryIcon,
  LockIcon,
  RestoreIcon,
  ShareIcon,
  StarIcon,
  TrashIcon,
} from '../components/Icons'
import type { BlockType } from '../lib/types'

const noop = () => undefined
const NO_MARKERS = new Set<string>()

function anchorFor(element: HTMLElement): FormatAnchor {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

function prefersTray(): boolean {
  return window.matchMedia('(max-width: 1024px), (any-pointer: coarse)').matches
}

interface NoteEditorProps {
  summary: NoteSummary
  doc: Y.Doc
  peers: Peer[]
  status: SyncState
  synced: boolean
  setCursor: (blockId: string | null, index?: number) => void
  retry: () => void
  members: Member[] | null
  token: string | null
  historyEvents: Realtime
  tagSuggestions?: string[]
  onSummaryChange: (summary: NoteSummary) => void
  onSaveTemplate: (draft: TemplateDraft) => Promise<void>
  onShare: () => void
  onDeleteForever: () => void
  onDuplicate: () => void
  onBack: () => void
  onToast: (message: string) => void
  onLock: (password: string | null) => Promise<void>
  onUnlock: (password: string | null) => Promise<void>
  onRemoveLock: () => Promise<void>
  autoFocus?: boolean
}

export function NoteEditor({
  summary,
  doc,
  peers,
  status,
  synced,
  setCursor,
  retry,
  members,
  token,
  historyEvents,
  tagSuggestions = [],
  onSummaryChange,
  onSaveTemplate,
  onShare,
  onDeleteForever,
  onDuplicate,
  onBack,
  onToast,
  onLock,
  onUnlock,
  onRemoveLock,
  autoFocus = false,
}: NoteEditorProps) {
  const [, bump] = useReducer((value: number) => value + 1, 0)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const [formatTarget, setFormatTarget] = useState<{
    blockId: string
    mode: FormatMode
    placement: FormatPlacement
    anchor: FormatAnchor | null
  } | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [trashConfirmOpen, setTrashConfirmOpen] = useState(false)
  const [lockOpen, setLockOpen] = useState(false)
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [removeLockOpen, setRemoveLockOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyEntryId, setHistoryEntryId] = useState<number | null>(null)
  // A visit-only grant: switching notes or refreshing re-locks the note.
  const [unlocked, setUnlocked] = useState(false)
  const [moving, setMoving] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [tagOpen, setTagOpen] = useState(false)
  const [tagIndex, setTagIndex] = useState(-1)
  const [titleDraft, setTitleDraft] = useState(() => noteMeta(doc).title)
  const titleRef = useRef<HTMLInputElement>(null)
  const menuWrapRef = useRef<HTMLDivElement>(null)
  const undoRef = useRef<Y.UndoManager | null>(null)
  const summaryRef = useRef(summary)
  summaryRef.current = summary
  const summaryChangeRef = useRef(onSummaryChange)
  summaryChangeRef.current = onSummaryChange

  const meta = noteMeta(doc)
  const isTrashed = meta.trashed
  const isLocked = summary.locked === true
  const lockProtected = summary.lockProtected === true
  const isOwner = summary.role === 'owner'
  const readOnly = isTrashed || (isLocked && !unlocked)
  const noteDate = meta.due ?? dateKey(new Date(meta.createdAt))
  const dayName = dayLabel(noteDate)
  const dayStamp = formatDayShort(noteDate)
  const views = blockViews(doc)
  const plain = plainText(doc)
  const suggestedTemplateName = (
    meta.title.trim() ||
    plain.split('\n').map((line) => line.trim()).find(Boolean) ||
    'Untitled template'
  ).slice(0, 60)
  const activeView = views.find((view) => view.id === activeBlockId) ?? null
  const formatView = formatTarget
    ? (views.find((view) => view.id === formatTarget.blockId) ?? null)
    : null
  const history = useNoteHistory(summary.id, token, historyEvents.subscribe, historyOpen)
  const activeHistoryId =
    historyEntryId != null && history.entries.some((entry) => entry.id === historyEntryId)
      ? historyEntryId
      : (history.entries[0]?.id ?? null)

  useEffect(() => {
    const metaMap = doc.getMap('meta')
    const blocks = doc.getArray('blocks')
    const handler = () => bump()
    metaMap.observe(handler)
    blocks.observe(handler)
    return () => {
      metaMap.unobserve(handler)
      blocks.unobserve(handler)
    }
  }, [doc])

  useEffect(() => {
    const manager = new Y.UndoManager([doc.getMap('meta'), doc.getArray('blocks')], {
      captureTimeout: 350,
    })
    undoRef.current = manager
    return () => {
      manager.destroy()
      undoRef.current = null
    }
  }, [doc])

  // Mirror note state into the sidebar index (and therefore offline cache).
  useEffect(() => {
    let timer = window.setTimeout(emit, 320)
    function emit() {
      const values = noteMeta(doc)
      const base = summaryRef.current
      summaryChangeRef.current({
        ...base,
        title: values.title,
        due: values.due,
        tags: values.tags,
        starred: values.starred,
        trashed: values.trashed,
        createdAt: values.createdAt,
        updatedAt: values.updatedAt,
        ownerId: values.ownerId,
        text: plainText(doc),
      })
    }
    const handler = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(emit, 500)
    }
    const metaMap = doc.getMap('meta')
    const blocks = doc.getArray('blocks')
    metaMap.observe(handler)
    blocks.observeDeep(handler)
    return () => {
      window.clearTimeout(timer)
      metaMap.unobserve(handler)
      blocks.unobserveDeep(handler)
    }
  }, [doc, summary.id])

  useEffect(() => {
    if (document.activeElement === titleRef.current) return
    setTitleDraft(meta.title)
  }, [meta.title])

  useEffect(() => {
    if (!moving) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoving(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moving])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (menuWrapRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!autoFocus || noteMeta(doc).trashed) return
    const first = blockArray(doc).get(0)
    if (!first) return
    const id = blockView(first).id
    setFocusRequest({ blockId: id, at: 'start', nonce: Date.now() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, doc])

  const requestFocus = useCallback((blockId: string, at: 'start' | 'end') => {
    setFocusRequest({ blockId, at, nonce: Date.now() })
  }, [])

  // Formatting is done from buttons outside the textarea. Put the caret back
  // where it was so a format choice never ends the editing session.
  const refocusBlock = useCallback((blockId: string) => {
    window.requestAnimationFrame(() => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-block-id]')].find(
        (element) => element.dataset.blockId === blockId,
      )
      row?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
    })
  }, [])

  const closeFormat = useCallback(() => setFormatTarget(null), [])

  const openFormat = useCallback(
    (blockId: string, anchor: HTMLElement | null, placement: FormatPlacement) => {
      setSlash(null)
      setFormatTarget({
        blockId,
        mode: prefersTray() ? 'tray' : 'popover',
        placement,
        anchor: anchor ? anchorFor(anchor) : null,
      })
    },
    [],
  )

  const applyFormatType = useCallback(
    (type: BlockType) => {
      if (!formatTarget) return
      const target = blockArray(doc)
        .toArray()
        .find((block) => blockView(block).id === formatTarget.blockId)
      if (!target) return
      doc.transact(() => {
        target.set('type', type)
        target.set('checked', false)
      })
      setActiveBlockId(formatTarget.blockId)
      refocusBlock(formatTarget.blockId)
    },
    [doc, formatTarget, refocusBlock],
  )

  const changeFormatIndent = useCallback(
    (delta: number) => {
      if (!formatTarget) return
      const target = blockArray(doc)
        .toArray()
        .find((block) => blockView(block).id === formatTarget.blockId)
      if (!target) return
      const current = Number(target.get('indent')) || 0
      const next = Math.min(3, Math.max(0, current + delta))
      if (next !== current) target.set('indent', next)
      refocusBlock(formatTarget.blockId)
    },
    [doc, formatTarget, refocusBlock],
  )

  // Style changes stay on the block, so the collaborative caret geometry and
  // activity history do not have to guess at inline spans.
  const applyFormatStyle = useCallback(
    (patch: Partial<BlockFormat>) => {
      if (!formatTarget) return
      const target = blockArray(doc)
        .toArray()
        .find((block) => blockView(block).id === formatTarget.blockId)
      if (!target) return
      doc.transact(() => applyBlockFormat(target, patch))
      setActiveBlockId(formatTarget.blockId)
      bump()
    },
    [doc, formatTarget],
  )

  const resetFormatStyle = useCallback(() => {
    if (!formatTarget) return
    const target = blockArray(doc)
      .toArray()
      .find((block) => blockView(block).id === formatTarget.blockId)
    if (!target) return
    doc.transact(() => clearBlockFormat(target))
    setActiveBlockId(formatTarget.blockId)
    bump()
  }, [doc, formatTarget])

  const pickCommand = useCallback(
    (type: BlockType) => {
      if (!slash) return
      const target = blockArray(doc)
        .toArray()
        .find((block) => blockView(block).id === slash.blockId)
      if (!target) return
      const text = blockTextNode(target)
      text.delete(0, text.length)
      target.set('type', type)
      target.set('checked', false)
      const id = blockView(target).id
      setSlash(null)
      window.requestAnimationFrame(() => requestFocus(id, 'start'))
    },
    [doc, slash, requestFocus],
  )

  const api: BlockRowApi = {
    insertAfter: (index, seed) => {
      const block = createBlock(doc, index + 1, seed)
      return blockView(block).id
    },
    remove: (index) => {
      const blocks = blockArray(doc)
      const fallback = blocks.length > 1 ? blocks.get(Math.max(0, index - 1)) : null
      const fallbackId = fallback ? blockView(fallback).id : null
      deleteBlock(doc, index)
      if (fallbackId) {
        window.requestAnimationFrame(() => requestFocus(fallbackId, 'end'))
      }
    },
    move: (from, to) => moveBlock(doc, from, to),
    requestFocus,
    clearFocus: () => setFocusRequest(null),
    setSlash: (next) => {
      if (next) setFormatTarget(null)
      setSlash(next)
    },
    slash,
    onPickCommand: pickCommand,
    openFormat: (blockId, anchor) => openFormat(blockId, anchor, 'block'),
    setDrag: setDragIndex,
    dragIndex,
    dropIndex,
    setDropIndex,
    onDropAt: (index) => {
      if (dragIndex === null) return
      const target = dragIndex < index ? index - 1 : index
      moveBlock(doc, dragIndex, target)
      setDragIndex(null)
      setDropIndex(null)
    },
  }

  const orders: (number | null)[] = []
  const counters = [0, 0, 0, 0]
  for (const view of views) {
    if (view.type !== 'number') {
      counters.fill(0)
      orders.push(null)
      continue
    }
    counters[view.indent] += 1
    for (let deeper = view.indent + 1; deeper < 4; deeper += 1) counters[deeper] = 0
    orders.push(counters[view.indent])
  }

  const cursorsByBlock = new Map<string, RemoteCursor[]>()
  for (const peer of peers) {
    if (!peer.cursor) continue
    const list = cursorsByBlock.get(peer.cursor.blockId) ?? []
    list.push({
      clientId: peer.clientId,
      displayName: peer.displayName,
      color: peer.color,
      index: peer.cursor.index,
    })
    cursorsByBlock.set(peer.cursor.blockId, list)
  }

  // Custom tags people already use come first, then the useful defaults.
  const tagOptions = (() => {
    const seen = new Set<string>()
    const options: string[] = []
    for (const tag of [...tagSuggestions].sort((a, b) => a.localeCompare(b))) {
      if (!seen.has(tag) && !meta.tags.includes(tag)) {
        seen.add(tag)
        options.push(tag)
      }
    }
    for (const tag of SUGGESTED_TAGS) {
      if (!seen.has(tag) && !meta.tags.includes(tag)) {
        seen.add(tag)
        options.push(tag)
      }
    }
    const needle = normalizeTag(tagDraft).toLowerCase()
    return (needle ? options.filter((tag) => tag.toLowerCase().includes(needle)) : options).slice(
      0,
      8,
    )
  })()
  const tagDraftValue = normalizeTag(tagDraft)
  const canCreateTag =
    tagDraftValue.length > 0 &&
    !meta.tags.includes(tagDraftValue) &&
    !tagOptions.includes(tagDraftValue)

  const addTagValue = (value: string) => {
    const tag = normalizeTag(value)
    setTagDraft('')
    setTagIndex(-1)
    if (!tag || meta.tags.includes(tag)) return
    patchMeta(doc, { tags: [...meta.tags, tag] })
  }

  const removeTag = (tag: string) => {
    patchMeta(doc, { tags: meta.tags.filter((value) => value !== tag) })
  }

  const moveTo = (value: string) => {
    if (!value) return
    patchMeta(doc, { due: value })
    setMoving(false)
  }

  const tidyBlankLines = () => {
    const blocks = blockArray(doc)
    const empties: number[] = []
    blocks.forEach((block, index) => {
      const view = blockView(block)
      if (view.type === 'text' && !view.text.trim()) empties.push(index)
    })
    // Never leave a note without a block to type into.
    const targets = empties.length === blocks.length ? empties.slice(1) : empties
    setMenuOpen(false)
    if (targets.length === 0) {
      onToast('No blank lines to tidy')
      return
    }
    doc.transact(() => {
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        blocks.delete(targets[index], 1)
      }
    })
    onToast(`Removed ${targets.length} blank ${targets.length === 1 ? 'line' : 'lines'}`)
  }

  const onUndoKeys = (event: React.KeyboardEvent) => {
    if (readOnly) return
    if (!(event.metaKey || event.ctrlKey)) return
    const key = event.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return
    const manager = undoRef.current
    if (!manager) return
    event.preventDefault()
    if (key === 'y' || event.shiftKey) manager.redo()
    else manager.undo()
  }

  const wordCount = plain.split(/\s+/).filter(Boolean).length
  const collaboratorCount = members?.length ?? summary.memberCount

  const moveToTrash = () => {
    patchMeta(doc, { trashed: true })
    setTrashConfirmOpen(false)
    setMenuOpen(false)
    setSaveTemplateOpen(false)
    setFormatTarget(null)
    setSlash(null)
    setMoving(false)
    onToast('Moved to trash')
  }

  const restoreNote = () => {
    patchMeta(doc, { trashed: false })
    onToast('Restored to your notes')
  }

  const unlockForVisit = async (password: string | null) => {
    try {
      await onUnlock(password)
      setUnlocked(true)
      onToast('Unlocked for this visit')
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not unlock this note')
    }
  }

  return (
    <section className={`note${isTrashed ? ' is-trashed' : ''}`} aria-label="Note editor">
      <header className="note__bar">
        <button type="button" className="icon-btn note__back" onClick={onBack} aria-label="Back to notes">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M14 5l-7 7 7 7M7 12h12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className="note__crumb">
          <span className="mono note__date">{dayLabel(noteDay(summary))}</span>
          <span className="note__sep" aria-hidden="true" />
          <span className="note__role">
            {summary.role === 'owner'
              ? collaboratorCount > 1
                ? `Shared with ${collaboratorCount - 1}`
                : 'Only you'
              : `Shared by ${summary.ownerName}`}
          </span>
          {isLocked ? (
            <span className="note__lock" title="Locked" aria-label="Locked">
              <LockIcon size={13} />
            </span>
          ) : null}
        </div>

        <div className="note__bar-actions">
          <ConnectionBadge status={status} synced={synced} onRetry={retry} compact />

          {peers.length > 0 ? (
            <div className="avatars" aria-label={`${peers.length} other ${peers.length === 1 ? 'person' : 'people'} here`}>
              {peers.slice(0, 3).map((peer) => (
                <span
                  key={peer.clientId}
                  className="avatar avatar--sm"
                  style={{ background: peer.color }}
                  title={`${peer.displayName} is here`}
                >
                  {initials(peer.displayName)}
                </span>
              ))}
              {peers.length > 3 ? <span className="avatars__more">+{peers.length - 3}</span> : null}
            </div>
          ) : null}

          {!isTrashed ? (
            <button
              type="button"
              className={`icon-btn note__history${historyOpen ? ' is-on' : ''}`}
              onClick={() => {
                setHistoryOpen((value) => !value)
                setHistoryEntryId(null)
                setMenuOpen(false)
                setSlash(null)
                closeFormat()
              }}
              aria-pressed={historyOpen}
              aria-label="Note activity and history"
              title={historyOpen ? 'Hide activity' : 'Activity & history'}
            >
              <HistoryIcon size={18} />
            </button>
          ) : null}

          {!readOnly && !historyOpen ? (
            <>
              <button
                type="button"
                className="icon-btn note__format"
                disabled={!activeView || activeView.type === 'divider'}
                onClick={(event) => {
                  if (!activeView) return
                  openFormat(activeView.id, event.currentTarget, 'header')
                }}
                onMouseDown={(event) => event.preventDefault()}
                aria-label={activeView ? `Format ${BLOCK_LABELS[activeView.type]} block` : 'Format block'}
                aria-haspopup="dialog"
                aria-expanded={Boolean(formatTarget && formatView)}
                title={
                  activeView?.type === 'divider'
                    ? 'Dividers have no text to format'
                    : activeView
                      ? 'Format this block'
                      : 'Tap a block, then format it'
                }
              >
                <span className="format-trigger" aria-hidden="true">
                  Aa
                </span>
              </button>

              <button
                type="button"
                className={`icon-btn${meta.starred ? ' is-on' : ''}`}
                onClick={() => patchMeta(doc, { starred: !meta.starred }, false)}
                aria-pressed={meta.starred}
                aria-label={meta.starred ? 'Remove star' : 'Star this note'}
                title={meta.starred ? 'Starred' : 'Star'}
              >
                <StarIcon size={18} filled={meta.starred} />
              </button>

              <button
                type="button"
                className="icon-btn"
                onClick={onShare}
                aria-label="Share this note"
                title="Share"
              >
                <ShareIcon size={18} />
              </button>
            </>
          ) : null}

          {isTrashed ? (
            <>
              <button
                type="button"
                className="icon-btn"
                onClick={restoreNote}
                aria-label="Restore from trash"
                title="Restore from trash"
              >
                <RestoreIcon size={18} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                onClick={onDeleteForever}
                aria-label="Permanently delete note"
                aria-haspopup="dialog"
                title="Permanently delete"
              >
                <TrashIcon size={18} />
              </button>
            </>
          ) : readOnly || historyOpen ? null : (
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              onClick={() => setTrashConfirmOpen(true)}
              aria-label="Move to trash"
              aria-haspopup="dialog"
              title="Move to trash"
            >
              <TrashIcon size={18} />
            </button>
          )}

          {!readOnly && !historyOpen ? (
            <div className="menu-wrap" ref={menuWrapRef}>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="More note actions"
              title="More"
            >
              <DotsIcon size={18} />
            </button>
            {menuOpen ? (
              <div className="menu" role="menu">
                  <button
                    type="button"
                    className="menu__item"
                    onClick={() => {
                      onDuplicate()
                      setMenuOpen(false)
                    }}
                  >
                    Duplicate note
                  </button>
                  <button
                    type="button"
                    className="menu__item"
                    onClick={() => {
                      setMenuOpen(false)
                      setSaveTemplateOpen(true)
                    }}
                  >
                    Save as template
                  </button>
                  <button type="button" className="menu__item" onClick={tidyBlankLines}>
                    Tidy blank lines
                  </button>
                  {isOwner && !isLocked ? (
                    <button
                      type="button"
                      className="menu__item"
                      onClick={() => {
                        setMenuOpen(false)
                        setLockOpen(true)
                      }}
                    >
                      Lock note…
                    </button>
                  ) : null}
                  {isOwner && isLocked ? (
                    <>
                      <button
                        type="button"
                        className="menu__item"
                        onClick={() => {
                          setMenuOpen(false)
                          setUnlocked(false)
                          onToast('Note locked again')
                        }}
                      >
                        Lock again
                      </button>
                      <button
                        type="button"
                        className="menu__item"
                        onClick={() => {
                          setMenuOpen(false)
                          setRemoveLockOpen(true)
                        }}
                      >
                        Remove lock…
                      </button>
                    </>
                  ) : null}
                  <div className="menu__foot">
                    <span className="mono">{summary.id.slice(0, 8)}</span>
                  </div>
                </div>
            ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {status === 'offline' ? (
        <div className="banner banner--offline">
          <span className="conn__dot" aria-hidden="true" />
          Working offline. Everything here is saved on this device and merges when you reconnect.
        </div>
      ) : null}

      {isLocked && !isTrashed ? (
        unlocked ? (
          <div className="banner banner--unlocked">
            <LockIcon size={14} />
            <span>Unlocked for this visit. It locks again when you leave this note.</span>
            <button
              type="button"
              className="link"
              onClick={() => {
                setUnlocked(false)
                onToast('Note locked again')
              }}
            >
              Lock again
            </button>
            {isOwner ? (
              <button type="button" className="link" onClick={() => setRemoveLockOpen(true)}>
                Remove lock
              </button>
            ) : null}
          </div>
        ) : (
          <div className="banner banner--locked">
            <LockIcon size={14} />
            <span>
              {isOwner
                ? 'This note is locked and read-only. Unlock it for this visit, or remove the lock so everyone can edit again.'
                : lockProtected
                  ? 'The owner locked this note. Unlock with the password to edit; it locks again when you leave.'
                  : 'The owner locked this note. Only the owner can unlock it.'}
            </span>
            {isOwner ? (
              <button type="button" className="link" onClick={() => void unlockForVisit(null)}>
                Unlock
              </button>
            ) : lockProtected ? (
              <button type="button" className="link" onClick={() => setUnlockOpen(true)}>
                Unlock with password
              </button>
            ) : null}
            {isOwner ? (
              <button
                type="button"
                className="link link--danger"
                onClick={() => setRemoveLockOpen(true)}
              >
                Remove lock
              </button>
            ) : null}
          </div>
        )
      ) : null}

      {isTrashed ? (
        <div className="banner banner--trash">
          <span>
            This note is in the trash and is read-only. Restore it to edit, star or share it. It is
            deleted automatically 10 days after trashing.
          </span>
          <button type="button" className="link" onClick={restoreNote}>
            Restore it
          </button>
        </div>
      ) : null}

      {historyOpen ? (
        <NoteHistoryView
          noteTitle={meta.title}
          blocks={views}
          entries={history.entries}
          loading={history.loading}
          error={history.error}
          selectedId={activeHistoryId}
          onSelect={setHistoryEntryId}
          onClose={() => {
            setHistoryOpen(false)
            setHistoryEntryId(null)
          }}
          onRefresh={history.refresh}
        />
      ) : (
      <div className="note__scroll" onKeyDownCapture={onUndoKeys}>
        <div className="note__title-wrap">
          <input
            ref={titleRef}
            className="note__title"
            value={titleDraft}
            placeholder="Untitled"
            aria-label="Note title"
            readOnly={readOnly}
            aria-readonly={readOnly}
            onChange={(event) => {
              if (readOnly) return
              setTitleDraft(event.target.value)
              patchMeta(doc, { title: event.target.value })
            }}
            onKeyDown={(event) => {
              if (readOnly) return
              if (event.key === 'Enter') {
                event.preventDefault()
                const first = blockArray(doc).get(0)
                if (first) requestFocus(blockView(first).id, 'start')
                else titleRef.current?.blur()
              }
            }}
          />

          <div className="note__meta">
            <div className="date-row">
              <span className="day-chip">
                <CalendarIcon size={14} />
                <span className="day-chip__label">{dayName}</span>
                {dayName !== dayStamp ? (
                  <span className="day-chip__date mono">{dayStamp}</span>
                ) : null}
              </span>
              {!readOnly ? (
                <button
                  type="button"
                  className="link day-move"
                  onClick={() => setMoving((value) => !value)}
                  aria-expanded={moving}
                  aria-haspopup="dialog"
                >
                  Move
                </button>
              ) : null}
              <button
                type="button"
                className="link history-mobile-link"
                onClick={() => {
                  setHistoryOpen(true)
                  setHistoryEntryId(null)
                  setMenuOpen(false)
                  setSlash(null)
                  closeFormat()
                }}
                aria-label="Open note activity"
              >
                <HistoryIcon size={13} />
                Activity
              </button>
              {!readOnly && moving ? (
                <>
                  <button
                    type="button"
                    className="menu-scrim"
                    aria-label="Close date picker"
                    onClick={() => setMoving(false)}
                  />
                  <div
                    className="day-pop"
                    role="dialog"
                    aria-label="Move this note to another date"
                  >
                    <span className="eyebrow">Move note to</span>
                    <Calendar selected={noteDate} markers={NO_MARKERS} onSelect={moveTo} />
                  </div>
                </>
              ) : null}
            </div>

            <div className="tag-row">
              {meta.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="tag-input"
                value={tagDraft}
                placeholder={meta.tags.length ? 'Add tag' : 'Add a tag'}
                aria-label="Add a tag"
                disabled={readOnly}
                aria-expanded={tagOpen}
                aria-controls="tag-suggestions"
                autoComplete="off"
                onFocus={() => setTagOpen(true)}
                onChange={(event) => {
                  setTagDraft(event.target.value)
                  setTagIndex(-1)
                  setTagOpen(true)
                }}
                onBlur={() => {
                  addTagValue(tagDraft)
                  setTagOpen(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setTagOpen(true)
                    setTagIndex((index) => Math.min(index + 1, tagOptions.length - 1))
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setTagIndex((index) => Math.max(index - 1, -1))
                    return
                  }
                  if (event.key === 'Escape') {
                    setTagOpen(false)
                    setTagIndex(-1)
                    return
                  }
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault()
                    if (tagIndex >= 0 && tagOptions[tagIndex]) addTagValue(tagOptions[tagIndex])
                    else addTagValue(tagDraft)
                    return
                  }
                  if (event.key === 'Backspace' && !tagDraft && meta.tags.length) {
                    removeTag(meta.tags[meta.tags.length - 1])
                  }
                }}
              />
              {!readOnly && tagOpen && (tagOptions.length > 0 || canCreateTag) ? (
                <div
                  className="tag-menu"
                  id="tag-suggestions"
                  role="listbox"
                  aria-label="Tag suggestions"
                >
                  {tagOptions.map((tag, index) => (
                    <button
                      key={tag}
                      type="button"
                      role="option"
                      aria-selected={index === tagIndex}
                      className={`tag-menu__item${index === tagIndex ? ' is-active' : ''}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setTagIndex(index)}
                      onClick={() => addTagValue(tag)}
                    >
                      <span className="tag-menu__hash" aria-hidden="true">
                        #
                      </span>
                      {tag}
                    </button>
                  ))}
                  {canCreateTag ? (
                    <button
                      type="button"
                      className="tag-menu__item tag-menu__create"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addTagValue(tagDraft)}
                    >
                      Create “{tagDraftValue}”
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="note__body">
          {views.map((view, index) => (
            <BlockRow
              key={view.id}
              doc={doc}
              block={blockArray(doc).get(index)}
              index={index}
              order={orders[index]}
              focusRequest={focusRequest}
              remoteCursors={cursorsByBlock.get(view.id) ?? []}
              api={api}
              readOnly={readOnly}
              formatOpen={formatTarget !== null}
              onTyping={closeFormat}
              onEdited={noop}
              onFocusBlock={(blockId, cursorIndex) => {
                if (blockId) setActiveBlockId(blockId)
                setCursor(blockId, cursorIndex)
              }}
            />
          ))}
          {!readOnly ? (
            <button
              type="button"
              className="block-add"
              onClick={() => {
                const block = createBlock(doc, views.length, { type: 'text', text: '' })
                requestFocus(blockView(block).id, 'start')
              }}
            >
              + Add block
            </button>
          ) : null}
        </div>

        <footer className="note__footer">
          <span>{wordCount} words</span>
          <span className="note__footer-sep" aria-hidden="true">
            ·
          </span>
          <span>{views.length} blocks</span>
          <span className="note__footer-sep" aria-hidden="true">
            ·
          </span>
          <span className="mono">edited {formatTime(meta.updatedAt)}</span>
          <span className="note__footer-right">
            {status === 'online' ? 'Saved to the server' : 'Saved on this device'}
          </span>
        </footer>
      </div>
      )}

      <ConfirmDialog
        open={trashConfirmOpen}
        title="Move to trash?"
        body="This note moves to the trash for everyone it is shared with. You can restore it for 10 days; after that it is permanently deleted."
        confirmLabel="Move to trash"
        onConfirm={moveToTrash}
        onClose={() => setTrashConfirmOpen(false)}
      />

      <SaveTemplateDialog
        open={saveTemplateOpen && !readOnly}
        defaultName={suggestedTemplateName}
        onClose={() => setSaveTemplateOpen(false)}
        onSave={async (name) => {
          await onSaveTemplate({
            name,
            title: meta.title.trim(),
            tags: meta.tags,
            blocks: views.map(({ type, text, checked, indent, format }) => ({
              type,
              text,
              checked,
              indent,
              format,
            })),
          })
          onToast('Template saved')
        }}
      />

      {!readOnly && formatTarget && formatView ? (
        <FormatMenu
          mode={formatTarget.mode}
          placement={formatTarget.placement}
          anchor={formatTarget.anchor}
          type={formatView.type}
          indent={formatView.indent}
          format={formatView.format}
          onType={applyFormatType}
          onIndent={changeFormatIndent}
          onFormat={applyFormatStyle}
          onReset={resetFormatStyle}
          onClose={closeFormat}
        />
      ) : null}

      {!readOnly && slash ? (
        <SlashMenu
          items={filterSlash(slash.query)}
          active={slash.index}
          top={slash.top}
          left={slash.left}
          onPick={(type) => pickCommand(type)}
        />
      ) : null}

      <LockNoteDialog
        open={lockOpen}
        noteTitle={meta.title.trim() || 'Untitled note'}
        onClose={() => setLockOpen(false)}
        onLock={async (password) => {
          await onLock(password)
          setUnlocked(false)
          onToast(password ? 'Note locked with a password' : 'Note locked')
        }}
      />

      <UnlockNoteDialog
        open={unlockOpen}
        noteTitle={meta.title.trim() || 'Untitled note'}
        onClose={() => setUnlockOpen(false)}
        onUnlock={async (password) => {
          await onUnlock(password)
          setUnlocked(true)
          onToast('Unlocked for this visit')
        }}
      />

      <ConfirmDialog
        open={removeLockOpen}
        title="Remove lock?"
        body="Everyone this note is shared with will be able to edit it again."
        confirmLabel="Remove lock"
        onConfirm={() => {
          void onRemoveLock()
            .then(() => {
              setUnlocked(false)
              setRemoveLockOpen(false)
              onToast('Lock removed')
            })
            .catch((error) => {
              setRemoveLockOpen(false)
              onToast(error instanceof Error ? error.message : 'Could not remove the lock')
            })
        }}
        onClose={() => setRemoveLockOpen(false)}
      />
    </section>
  )
}
