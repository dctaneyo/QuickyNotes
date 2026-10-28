import type { CSSProperties } from 'react'
import { HistoryIcon } from '../components/Icons'
import { BLOCK_LABELS, colorFor, initials } from '../lib/notes'
import {
  formatSignature,
  formatTextStyle,
  normalizeBlockFormat,
} from '../lib/formatting'
import { diffText, type DiffPart } from '../lib/textDiff'
import type { BlockType, NoteHistoryChange, NoteHistoryEntry } from '../lib/types'
import type { BlockView } from '../sync/noteModel'

interface NoteHistoryViewProps {
  noteTitle: string
  blocks: BlockView[]
  entries: NoteHistoryEntry[]
  loading: boolean
  error: string | null
  selectedId: number | null
  onSelect: (id: number) => void
  onClose: () => void
  onRefresh: () => void
}

interface RenderItem {
  block: BlockView
  change?: NoteHistoryChange
}

function relativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp)
  if (diff < 45_000) return 'just now'
  const minutes = Math.round(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(timestamp),
  )
}

function fullTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(timestamp),
  )
}

function summarize(entry: NoteHistoryEntry): string {
  let added = 0
  let removed = 0
  let text = 0
  let formatting = 0
  let title = false
  for (const change of entry.changes) {
    if (change.field === 'title') {
      title = true
      continue
    }
    if (change.kind === 'added') added += 1
    else if (change.kind === 'removed') removed += 1
    else if (change.before !== change.after) text += 1
    else formatting += 1
  }
  const parts: string[] = []
  if (text) parts.push(text === 1 ? '1 text edit' : `${text} text edits`)
  if (added) parts.push(`+${added} block${added === 1 ? '' : 's'}`)
  if (removed) parts.push(`−${removed} block${removed === 1 ? '' : 's'}`)
  if (formatting) parts.push('formatting')
  if (title) parts.push('title')
  return parts.join(' · ') || 'Edited'
}

function insertAt(blocks: BlockView[], block: BlockView, index: number | undefined) {
  const at = Math.min(Math.max(index ?? blocks.length, 0), blocks.length)
  blocks.splice(at, 0, block)
}

/** Walk newer entries backwards so an older activity point shows that version. */
function buildVersion(
  blocks: BlockView[],
  title: string,
  entries: NoteHistoryEntry[],
  selectedIndex: number,
): { title: string; blocks: BlockView[] } {
  const state = {
    title,
    blocks: blocks.map((block) => ({ ...block, format: { ...block.format } })),
  }
  if (selectedIndex <= 0) return state

  for (let index = 0; index < selectedIndex; index += 1) {
    for (const change of entries[index].changes) {
      if (change.field === 'title') {
        state.title = change.before
        continue
      }
      if (change.kind === 'added') {
        state.blocks = state.blocks.filter((block) => block.id !== change.blockId)
        continue
      }
      if (change.kind === 'removed') {
        if (!state.blocks.some((block) => block.id === change.blockId)) {
          insertAt(
            state.blocks,
            {
              id: change.blockId,
              type: (change.beforeType ?? 'text') as BlockType,
              text: change.before,
              checked: change.beforeChecked === true,
              indent: change.beforeIndent ?? 0,
              format: normalizeBlockFormat(change.beforeFormat),
            },
            change.index,
          )
        }
        continue
      }
      const block = state.blocks.find((candidate) => candidate.id === change.blockId)
      if (block) {
        block.text = change.before
        block.type = (change.beforeType ?? block.type) as BlockType
        block.checked = change.beforeChecked === true
        block.indent = change.beforeIndent ?? 0
        if (change.beforeFormat !== undefined) {
          block.format = normalizeBlockFormat(change.beforeFormat)
        }
      } else {
        insertAt(
          state.blocks,
          {
            id: change.blockId,
            type: (change.beforeType ?? 'text') as BlockType,
            text: change.before,
            checked: change.beforeChecked === true,
            indent: change.beforeIndent ?? 0,
            format: normalizeBlockFormat(change.beforeFormat),
          },
          change.index,
        )
      }
    }
  }
  return state
}

function renderParts(parts: DiffPart[]) {
  return parts.map((part, index) => {
    if (part.kind === 'ins') {
      return (
        <mark className="hist-ins" key={index}>
          {part.text}
        </mark>
      )
    }
    if (part.kind === 'del') {
      return (
        <del className="hist-del" key={index}>
          {part.text}
        </del>
      )
    }
    return <span key={index}>{part.text}</span>
  })
}

function changeLabel(change: NoteHistoryChange | undefined): string | null {
  if (!change) return null
  if (change.kind === 'added') return 'Added'
  if (change.kind === 'removed') return 'Removed'
  if (change.beforeType !== change.afterType) {
    const before = BLOCK_LABELS[(change.beforeType ?? 'text') as BlockType] ?? 'Text'
    const after = BLOCK_LABELS[(change.afterType ?? 'text') as BlockType] ?? 'Text'
    return `${before} → ${after}`
  }
  if (change.beforeChecked !== change.afterChecked) {
    return change.afterChecked ? 'Marked done' : 'Reopened'
  }
  if (change.beforeIndent !== change.afterIndent) {
    return (change.afterIndent ?? 0) > (change.beforeIndent ?? 0) ? 'Indented' : 'Outdented'
  }
  if (change.beforeFormat !== undefined || change.afterFormat !== undefined) {
    const before = formatSignature(normalizeBlockFormat(change.beforeFormat))
    const after = formatSignature(normalizeBlockFormat(change.afterFormat))
    if (before !== after) return 'Restyled'
  }
  return null
}

function HistoryBlock({
  item,
  number,
  authorColor,
}: {
  item: RenderItem
  number: number
  authorColor: string
}) {
  const { block, change } = item
  const label = changeLabel(change)
  const isDivider = block.type === 'divider'
  const parts: DiffPart[] = change
    ? change.kind === 'removed'
      ? [{ text: change.before, kind: 'del' }]
      : change.kind === 'added'
        ? [{ text: change.after, kind: 'ins' }]
        : diffText(change.before, change.after)
    : [{ text: block.text, kind: 'same' }]

  const marker =
    block.type === 'bullet' ? (
      <span className="block__marker" aria-hidden="true">
        •
      </span>
    ) : block.type === 'number' ? (
      <span className="block__marker block__marker--number" aria-hidden="true">
        {number}.
      </span>
    ) : block.type === 'todo' ? (
      <span className="todo__box history-todo" aria-hidden="true">
        {block.checked ? '✓' : ''}
      </span>
    ) : null

  return (
    <div
      className={`block block--${block.type}${block.checked ? ' is-checked' : ''}${
        change ? ' history-block is-changed' : ''
      }${change?.kind === 'removed' ? ' history-block--removed' : ''}`}
      style={
        {
          marginLeft: block.indent > 0 ? block.indent * 22 : undefined,
          '--hist-author': authorColor,
        } as CSSProperties
      }
    >
      {isDivider ? (
        <>
          <hr className="block__rule" />
          {label ? <span className="history-block__note">{label}</span> : null}
        </>
      ) : (
        <>
          {marker}
          <div className="history-block__body">
            <div
              className={`block__input history-block__text history-block__text--${block.type}`}
              style={formatTextStyle(block.format)}
            >
              {parts.length ? renderParts(parts) : '\u200b'}
            </div>
            {label ? <span className="history-block__note">{label}</span> : null}
          </div>
        </>
      )}
    </div>
  )
}

export function NoteHistoryView({
  noteTitle,
  blocks,
  entries,
  loading,
  error,
  selectedId,
  onSelect,
  onClose,
  onRefresh,
}: NoteHistoryViewProps) {
  const selectedIndex =
    selectedId == null ? 0 : Math.max(0, entries.findIndex((entry) => entry.id === selectedId))
  const selected = entries[selectedIndex] ?? null
  const authorColor = selected ? colorFor(selected.actorId) : 'var(--accent)'
  const version = buildVersion(blocks, noteTitle, entries, selected ? selectedIndex : -1)
  const titleChange = selected?.changes.find((change) => change.field === 'title')
  const changeMap = new Map(
    (selected?.changes ?? [])
      .filter((change) => change.field === 'block')
      .map((change) => [change.blockId, change]),
  )

  const items: RenderItem[] = version.blocks.map((block) => ({
    block,
    change: changeMap.get(block.id),
  }))

  if (selected) {
    for (const change of selected.changes) {
      if (
        change.field !== 'block' ||
        change.kind !== 'removed' ||
        version.blocks.some((block) => block.id === change.blockId)
      ) {
        continue
      }
      items.splice(
        Math.min(Math.max(change.index ?? items.length, 0), items.length),
        0,
        {
          block: {
            id: change.blockId,
            type: (change.beforeType ?? 'text') as BlockType,
            text: change.before,
            checked: change.beforeChecked === true,
            indent: change.beforeIndent ?? 0,
            format: normalizeBlockFormat(change.beforeFormat),
          },
          change,
        },
      )
    }
  }

  const numbered = items.map((item, index) => {
    if (item.block.type !== 'number') return { item, number: 0 }
    let count = 1
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const candidate = items[previous].block
      if (candidate.type !== 'number' || candidate.indent !== item.block.indent) break
      count += 1
    }
    return { item, number: count }
  })

  return (
    <section className="history-view" aria-label="Note activity">
      <div className="history__bar">
        <HistoryIcon size={16} />
        <span className="eyebrow">Note activity</span>
        <span className="history__count" aria-live="polite">
          {entries.length} {entries.length === 1 ? 'change' : 'changes'}
        </span>
        <button type="button" className="btn btn--ghost history__done" onClick={onClose}>
          Done
        </button>
      </div>

      {entries.length > 0 ? (
        <div className="history__timeline" aria-label="Activity timeline">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`history__entry${entry.id === selected?.id ? ' is-active' : ''}`}
              onClick={() => onSelect(entry.id)}
              aria-pressed={entry.id === selected?.id}
              title={fullTime(entry.createdAt)}
            >
              <span
                className="avatar avatar--xs"
                style={{ background: colorFor(entry.actorId) }}
                aria-hidden="true"
              >
                {initials(entry.actorName)}
              </span>
              <span className="history__who">{entry.actorName}</span>
              <span className="history__when">{relativeTime(entry.createdAt)}</span>
              <span className="history__summary">{summarize(entry)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="history__scroll">
        <div
          className="history__content"
          style={{ '--hist-author': authorColor } as CSSProperties}
        >
          {error ? (
            <div className="history__state history__state--error" role="alert">
              <p>{error}</p>
              <button type="button" className="btn btn--ghost" onClick={onRefresh}>
                Try again
              </button>
            </div>
          ) : null}

          {!selected && !error ? (
            <div className="history__state">
              {loading ? (
                <>
                  <span className="history__pulse" aria-hidden="true" />
                  <p>Loading activity…</p>
                </>
              ) : (
                <>
                  <HistoryIcon size={22} />
                  <p>No activity yet.</p>
                  <span>
                    Edits appear here as you and the people you share this note with write.
                  </span>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="history__banner">
                <span
                  className="avatar"
                  style={{ background: colorFor(selected.actorId) }}
                  aria-hidden="true"
                >
                  {initials(selected.actorName)}
                </span>
                <div className="history__banner-main">
                  <div className="history__banner-name">{selected.actorName}</div>
                  <div className="history__banner-meta">
                    {relativeTime(selected.createdAt)} · {fullTime(selected.createdAt)}
                  </div>
                </div>
                <span className="history__legend" aria-label="Change legend">
                  <mark className="hist-ins">added</mark>
                  <del className="hist-del">removed</del>
                </span>
              </div>

              <div className="history__title-wrap">
                <div className="note__title history__title">
                  {titleChange ? (
                    renderParts(diffText(titleChange.before, titleChange.after))
                  ) : version.title ? (
                    version.title
                  ) : (
                    <span className="history__title-empty">Untitled</span>
                  )}
                </div>
                {titleChange ? <span className="history-block__note">Renamed title</span> : null}
              </div>

              <div className="note__body history__body">
                {numbered.map(({ item, number: itemNumber }) => (
                  <HistoryBlock
                    key={`${item.block.id}-${item.change?.kind ?? 'same'}`}
                    item={item}
                    number={itemNumber}
                    authorColor={authorColor}
                  />
                ))}
              </div>

              <div className="history__foot">
                <span>
                  Showing the note as it looked after this change. Highlighted text was added;
                  struck text was removed.
                </span>
                {loading ? <span className="history__refreshing">Updating…</span> : null}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
