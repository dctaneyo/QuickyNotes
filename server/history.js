import { db } from './db.js'
import { pushNoteHistory } from './events.js'

const FLUSH_MS = 1600
const MAX_ENTRIES = 200
const pending = new Map()

function textOf(block) {
  const value = block.get?.('text')
  return typeof value?.toString === 'function' ? value.toString() : ''
}

function typeOf(block) {
  const value = block.get?.('type')
  return typeof value === 'string' ? value : 'text'
}

function indentOf(block) {
  return Number(block.get?.('indent')) || 0
}

function formatOf(block) {
  const size = Math.round(Number(block.get?.('fontSize')))
  const color = block.get?.('color')
  const highlight = block.get?.('highlight')
  return {
    bold: block.get?.('bold') === true,
    italic: block.get?.('italic') === true,
    underline: block.get?.('underline') === true,
    strike: block.get?.('strike') === true,
    fontSize: Number.isFinite(size) && size > 0 ? size : null,
    color: typeof color === 'string' ? color : null,
    highlight: typeof highlight === 'string' ? highlight : null,
  }
}

function formatKey(format) {
  return JSON.stringify(format ?? null)
}

export function noteSnapshot(doc) {
  const meta = doc.getMap('meta')
  const title = meta.get('title')
  return {
    title: typeof title === 'string' ? title : '',
    blocks: doc
      .getArray('blocks')
      .toArray()
      .map((block, index) => ({
        id: String(block.get('id') ?? `index-${index}`),
        index,
        type: typeOf(block),
        text: textOf(block),
        checked: block.get('checked') === true,
        indent: indentOf(block),
        format: formatOf(block),
      })),
  }
}

/** Field-level changes between two snapshots, keyed by block id. */
export function diffSnapshots(before, after) {
  const changes = []
  if (before.title !== after.title) {
    changes.push({
      blockId: 'title',
      field: 'title',
      kind: 'changed',
      before: before.title,
      after: after.title,
    })
  }

  const previous = new Map(before.blocks.map((block) => [block.id, block]))
  const current = new Map(after.blocks.map((block) => [block.id, block]))

  for (const block of after.blocks) {
    const old = previous.get(block.id)
    if (!old) {
      changes.push({
        blockId: block.id,
        field: 'block',
        kind: 'added',
        before: '',
        after: block.text,
        beforeType: null,
        afterType: block.type,
        beforeChecked: false,
        afterChecked: block.checked,
        beforeIndent: 0,
        afterIndent: block.indent,
        beforeFormat: null,
        afterFormat: block.format,
        index: block.index,
      })
      continue
    }
    if (
      old.text !== block.text ||
      old.type !== block.type ||
      old.checked !== block.checked ||
      old.indent !== block.indent ||
      formatKey(old.format) !== formatKey(block.format)
    ) {
      changes.push({
        blockId: block.id,
        field: 'block',
        kind: 'changed',
        before: old.text,
        after: block.text,
        beforeType: old.type,
        afterType: block.type,
        beforeChecked: old.checked,
        afterChecked: block.checked,
        beforeIndent: old.indent,
        afterIndent: block.indent,
        beforeFormat: old.format,
        afterFormat: block.format,
        index: block.index,
      })
    }
  }

  for (const block of before.blocks) {
    if (current.has(block.id)) continue
    changes.push({
      blockId: block.id,
      field: 'block',
      kind: 'removed',
      before: block.text,
      after: '',
      beforeType: block.type,
      afterType: null,
      beforeChecked: block.checked,
      afterChecked: false,
      beforeIndent: block.indent,
      afterIndent: 0,
      beforeFormat: block.format,
      afterFormat: null,
      index: block.index,
    })
  }

  return changes
}

function merged(existing, change) {
  const next = {
    ...existing,
    after: change.after,
    afterType: change.afterType,
    afterChecked: change.afterChecked,
    afterIndent: change.afterIndent,
    afterFormat: change.afterFormat ?? existing.afterFormat,
    index: change.index ?? existing.index,
    kind: existing.kind,
  }
  if (existing.kind === 'added') {
    next.kind = 'added'
  } else if (change.kind === 'removed') {
    next.kind = 'removed'
  } else {
    next.kind = 'changed'
  }
  return next
}

function isEmpty(change) {
  return (
    change.before === change.after &&
    change.beforeType === change.afterType &&
    change.beforeChecked === change.afterChecked &&
    change.beforeIndent === change.afterIndent &&
    formatKey(change.beforeFormat) === formatKey(change.afterFormat)
  )
}

function flush(key) {
  const entry = pending.get(key)
  pending.delete(key)
  if (!entry || entry.changes.size === 0) return
  const changes = [...entry.changes.values()]
  try {
    db.prepare(
      `INSERT INTO note_history (note_id, actor_id, actor_name, created_at, changes)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(entry.noteId, entry.actorId, entry.actorName, Date.now(), JSON.stringify(changes))
    db.prepare(
      `DELETE FROM note_history WHERE note_id = ? AND id NOT IN (
         SELECT id FROM note_history WHERE note_id = ? ORDER BY id DESC LIMIT ?
       )`,
    ).run(entry.noteId, entry.noteId, MAX_ENTRIES)
    pushNoteHistory(entry.noteId)
  } catch (error) {
    console.error('[history] could not record note', entry.noteId, error.message)
  }
}

/**
 * A burst of keystrokes from one person becomes one activity entry once they
 * pause. The entry keeps the earliest "before" and the latest "after" text.
 */
export function recordNoteHistory(noteId, user, before, after) {
  if (!user?.userId) return
  const changes = diffSnapshots(before, after)
  if (changes.length === 0) return

  const key = `${noteId}:${user.userId}`
  const entry = pending.get(key) ?? {
    noteId,
    actorId: user.userId,
    actorName: user.displayName || user.userId,
    changes: new Map(),
    timer: null,
  }

  for (const change of changes) {
    const existing = entry.changes.get(change.blockId)
    if (!existing) {
      entry.changes.set(change.blockId, change)
      continue
    }
    const next = merged(existing, change)
    if (isEmpty(next)) entry.changes.delete(change.blockId)
    else entry.changes.set(change.blockId, next)
  }

  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => flush(key), FLUSH_MS)
  pending.set(key, entry)
}
