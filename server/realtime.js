import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { db } from './db.js'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const SAVE_DEBOUNCE_MS = 500
const ROOM_IDLE_MS = 5_000

/** @type {Map<string, Room>} */
const rooms = new Map()

function loadPersistedState(room) {
  if (!room.startsWith('note:')) return null
  const row = db.prepare('SELECT content FROM notes WHERE id = ?').get(room.slice(5))
  if (!row?.content) return null
  return new Uint8Array(row.content)
}

function scheduleSave(entry) {
  if (!entry.room.startsWith('note:')) return
  clearTimeout(entry.saveTimer)
  entry.saveTimer = setTimeout(() => saveRoom(entry), SAVE_DEBOUNCE_MS)
}

function saveRoom(entry) {
  if (!entry.room.startsWith('note:')) return
  const noteId = entry.room.slice(5)
  try {
    const update = Y.encodeStateAsUpdate(entry.doc)
    const meta = entry.doc.getMap('meta').toJSON()
    const updatedAt = Number(meta.updatedAt) || Date.now()
    // Plain text is mirrored into SQLite so search works on cold notes without
    // loading every Yjs document.
    const text = entry.doc
      .getArray('blocks')
      .toArray()
      .map((block) => {
        const value = block.get?.('text')
        return typeof value?.toString === 'function' ? value.toString() : ''
      })
      .join('\n')
    db.prepare(
      `UPDATE notes SET content = ?, title = ?, due = ?, starred = ?, trashed = ?, updated_at = ?, text = ?, tags = ?
       WHERE id = ?`,
    ).run(
      Buffer.from(update),
      typeof meta.title === 'string' ? meta.title : '',
      typeof meta.due === 'string' && meta.due ? meta.due : null,
      meta.starred ? 1 : 0,
      meta.trashed ? 1 : 0,
      updatedAt,
      text.slice(0, 20_000),
      JSON.stringify(Array.isArray(meta.tags) ? meta.tags.slice(0, 20) : []),
      noteId,
    )
  } catch (error) {
    console.error('[sync] could not persist note', noteId, error.message)
  }
}

function getRoom(room) {
  const existing = rooms.get(room)
  if (existing) return existing

  const doc = new Y.Doc({ gc: true })
  const stored = loadPersistedState(room)
  if (stored) Y.applyUpdate(doc, stored, 'storage')

  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null) // the server itself has no cursor

  /** @type {Room} */
  const entry = { room, doc, awareness, conns: new Set(), saveTimer: null }
  rooms.set(room, entry)

  doc.on('update', (update, origin) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    const message = encoding.toUint8Array(encoder)
    for (const conn of entry.conns) {
      if (conn !== origin && conn.readyState === 1) conn.send(message)
    }
    scheduleSave(entry)
  })

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = [...added, ...updated, ...removed]
    if (changed.length === 0) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changed),
    )
    const message = encoding.toUint8Array(encoder)
    for (const conn of entry.conns) {
      if (conn !== origin && conn.readyState === 1) conn.send(message)
    }
  })

  return entry
}

/** Pull the client ids out of an awareness update so we can clean up on close. */
function readAwarenessClientIds(update) {
  const decoder = decoding.createDecoder(update)
  const count = decoding.readVarUint(decoder)
  const ids = []
  for (let index = 0; index < count; index += 1) {
    ids.push(decoding.readVarUint(decoder))
    decoding.readVarUint(decoder) // clock
    decoding.readVarString(decoder) // json state
  }
  return ids
}

export function attachConnection(conn, room) {
  const entry = getRoom(room)
  entry.conns.add(conn)
  conn.awarenessIds = new Set()

  // 1. Hand the client the current document state.
  {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(encoder, entry.doc)
    conn.send(encoding.toUint8Array(encoder))
  }

  // 2. Hand over anyone already present.
  const states = entry.awareness.getStates()
  if (states.size > 0) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(entry.awareness, [...states.keys()]),
    )
    conn.send(encoding.toUint8Array(encoder))
  }

  conn.on('message', (data) => {
    try {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      const decoder = decoding.createDecoder(bytes)
      const messageType = decoding.readVarUint(decoder)

      if (messageType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, entry.doc, conn)
        if (encoding.length(encoder) > 1) conn.send(encoding.toUint8Array(encoder))
        return
      }

      if (messageType === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder)
        for (const id of readAwarenessClientIds(update)) conn.awarenessIds.add(id)
        awarenessProtocol.applyAwarenessUpdate(entry.awareness, update, conn)
      }
    } catch (error) {
      console.error('[sync] bad message', error.message)
    }
  })

  conn.on('close', () => {
    entry.conns.delete(conn)
    if (conn.awarenessIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        entry.awareness,
        [...conn.awarenessIds],
        'disconnect',
      )
    }
    if (entry.conns.size === 0) {
      clearTimeout(entry.saveTimer)
      saveRoom(entry)
      // Keep the document warm briefly so quick reloads do not re-read SQLite.
      setTimeout(() => {
        const live = rooms.get(room)
        if (!live || live.conns.size > 0) return
        live.awareness.destroy()
        live.doc.destroy()
        rooms.delete(room)
      }, ROOM_IDLE_MS).unref()
    }
  })

  conn.on('error', () => {})
}

export function closeAllRooms() {
  for (const entry of rooms.values()) {
    clearTimeout(entry.saveTimer)
    saveRoom(entry)
    entry.awareness.destroy()
    entry.doc.destroy()
  }
  rooms.clear()
}

/**
 * @typedef {{ room: string, doc: Y.Doc, awareness: awarenessProtocol.Awareness,
 *   conns: Set<import('ws').WebSocket>, saveTimer: NodeJS.Timeout | null }} Room
 */
