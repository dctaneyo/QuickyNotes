import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import * as Y from 'yjs'
import type { Member, NoteSummary, SyncState } from '../lib/types'
import {
  dateKey,
  dayLabel,
  formatDayShort,
  formatTime,
  initials,
  normalizeTag,
  noteDay,
} from '../lib/notes'
import {
  blockArray,
  blockTextNode,
  blockView,
  blockViews,
  createBlock,
  deleteBlock,
  moveBlock,
  noteMeta,
  patchMeta,
  plainText,
} from '../sync/noteModel'
import type { Peer } from '../sync/useNoteSync'
import { BlockRow, type BlockRowApi, type FocusRequest, type SlashState } from './BlockRow'
import { SlashMenu, filterSlash } from './SlashMenu'
import { Calendar } from './Calendar'
import { ConnectionBadge } from '../components/ConnectionBadge'
import { CalendarIcon, DotsIcon, ShareIcon, StarIcon } from '../components/Icons'
import type { BlockType } from '../lib/types'

const noop = () => undefined
const NO_MARKERS = new Set<string>()

interface NoteEditorProps {
  summary: NoteSummary
  doc: Y.Doc
  peers: Peer[]
  status: SyncState
  synced: boolean
  setFocus: (blockId: string | null) => void
  retry: () => void
  members: Member[] | null
  onSummaryChange: (summary: NoteSummary) => void
  onShare: () => void
  onDeleteForever: () => void
  onDuplicate: () => void
  onBack: () => void
  onToast: (message: string) => void
  autoFocus?: boolean
}

export function NoteEditor({
  summary,
  doc,
  peers,
  status,
  synced,
  setFocus,
  retry,
  members,
  onSummaryChange,
  onShare,
  onDeleteForever,
  onDuplicate,
  onBack,
  onToast,
  autoFocus = false,
}: NoteEditorProps) {
  const [, bump] = useReducer((value: number) => value + 1, 0)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [moving, setMoving] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [titleDraft, setTitleDraft] = useState(() => noteMeta(doc).title)
  const titleRef = useRef<HTMLInputElement>(null)
  const undoRef = useRef<Y.UndoManager | null>(null)
  const summaryRef = useRef(summary)
  summaryRef.current = summary
  const summaryChangeRef = useRef(onSummaryChange)
  summaryChangeRef.current = onSummaryChange

  const meta = noteMeta(doc)
  const noteDate = meta.due ?? dateKey(new Date(meta.createdAt))
  const dayName = dayLabel(noteDate)
  const dayStamp = formatDayShort(noteDate)
  const views = blockViews(doc)
  const plain = plainText(doc)

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
    if (!autoFocus) return
    const first = blockArray(doc).get(0)
    if (!first) return
    const id = blockView(first).id
    setFocusRequest({ blockId: id, at: 'start', nonce: Date.now() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, doc])

  const requestFocus = useCallback((blockId: string, at: 'start' | 'end') => {
    setFocusRequest({ blockId, at, nonce: Date.now() })
  }, [])

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
    setSlash,
    slash,
    onPickCommand: pickCommand,
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

  const peerByBlock = new Map<string, Peer>()
  for (const peer of peers) {
    if (peer.focus) peerByBlock.set(peer.focus, peer)
  }

  const addTag = () => {
    const tag = normalizeTag(tagDraft)
    setTagDraft('')
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

  const trash = () => {
    patchMeta(doc, { trashed: !meta.trashed })
    setMenuOpen(false)
    onToast(meta.trashed ? 'Restored to your notes' : 'Moved to trash')
  }

  return (
    <section className="note" aria-label="Note editor">
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

          <div className="menu-wrap">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-label="More note actions"
              title="More"
            >
              <DotsIcon size={18} />
            </button>
            {menuOpen ? (
              <>
                <button
                  type="button"
                  className="menu-scrim"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                />
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
                  <button type="button" className="menu__item" onClick={tidyBlankLines}>
                    Tidy blank lines
                  </button>
                  <button type="button" className="menu__item" onClick={trash}>
                    {meta.trashed ? 'Restore from trash' : 'Move to trash'}
                  </button>
                  {meta.trashed && summary.role === 'owner' ? (
                    <button
                      type="button"
                      className="menu__item menu__item--danger"
                      onClick={() => {
                        setMenuOpen(false)
                        onDeleteForever()
                      }}
                    >
                      Delete forever
                    </button>
                  ) : null}
                  <div className="menu__foot">
                    <span className="mono">{summary.id.slice(0, 8)}</span>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {status === 'offline' ? (
        <div className="banner banner--offline">
          <span className="conn__dot" aria-hidden="true" />
          Working offline. Everything here is saved on this device and merges when you reconnect.
        </div>
      ) : null}

      {meta.trashed ? (
        <div className="banner banner--trash">
          This note is in the trash.
          <button type="button" className="link" onClick={() => patchMeta(doc, { trashed: false })}>
            Restore it
          </button>
        </div>
      ) : null}

      <div className="note__scroll" onKeyDownCapture={onUndoKeys}>
        <div className="note__title-wrap">
          <input
            ref={titleRef}
            className="note__title"
            value={titleDraft}
            placeholder="Untitled"
            aria-label="Note title"
            onChange={(event) => {
              setTitleDraft(event.target.value)
              patchMeta(doc, { title: event.target.value })
            }}
            onKeyDown={(event) => {
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
              <button
                type="button"
                className="link day-move"
                onClick={() => setMoving((value) => !value)}
                aria-expanded={moving}
                aria-haspopup="dialog"
              >
                Move
              </button>
              {moving ? (
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
                  <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`}>
                    ×
                  </button>
                </span>
              ))}
              <input
                className="tag-input"
                value={tagDraft}
                placeholder={meta.tags.length ? 'Add tag' : 'Add a tag'}
                aria-label="Add a tag"
                onChange={(event) => setTagDraft(event.target.value)}
                onBlur={addTag}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault()
                    addTag()
                  }
                  if (event.key === 'Backspace' && !tagDraft && meta.tags.length) {
                    removeTag(meta.tags[meta.tags.length - 1])
                  }
                }}
              />
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
              remotePeer={peerByBlock.get(view.id)}
              api={api}
              onEdited={noop}
              onFocusBlock={(blockId) => setFocus(blockId)}
            />
          ))}
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

      {slash ? (
        <SlashMenu
          items={filterSlash(slash.query)}
          active={slash.index}
          top={slash.top}
          left={slash.left}
          onPick={(type) => pickCommand(type)}
        />
      ) : null}
    </section>
  )
}
