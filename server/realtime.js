import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { db } from './db.js'
import { pushNotesForNote } from './events.js'
import {
  applyHistorySnapshot,
  noteSnapshot,
  recordNoteHistory,
  snapshotAtHistoryEntry,
} from './history.js'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
// Private message types above the y-websocket protocol's 0-3 range.
const MESSAGE_SAVED = 4
const MESSAGE_SAVE_ERROR = 5
const MESSAGE_LOADED = 6
const SAVE_DEBOUNCE_MS = 500
const SAVE_RETRY_MS = 2_000
const ROOM_IDLE_MS = 5_000

/** @type {Map<string, Room>} */
const rooms = new Map()
let activityHandler = () => {}

/**
 * The HTTP layer owns session and note permissions; this callback is consulted
 * before every sync update so access cannot outlive a membership or lock
 * change. It may return a close code when read access is gone.
 */
let connectionAuthorizer = () => ({ read: true, write: true })

export function setConnectionAuthorizer(handler) {
  connectionAuthorizer = handler
}

/** Let the HTTP layer mirror live-room counts into the admin snapshot. */
export function onRoomActivity(handler) {
  activityHandler = handler
}

function notifyActivity() {
  try {
    activityHandler()
  } catch {
    // Activity telemetry must never break sync.
  }
}

function loadPersistedState(room) {
  if (!room.startsWith('note:')) return null
  const row = db.prepare('SELECT content FROM notes WHERE id = ?').get(room.slice(5))
  if (!row?.content) return null
  return new Uint8Array(row.content)
}

function sendSaveAck(conn, savedAt) {
  if (conn.readyState !== 1) return
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SAVED)
  encoding.writeVarString(encoder, String(savedAt))
  conn.send(encoding.toUint8Array(encoder))
}

function sendLoaded(conn, loadedAt) {
  if (conn.readyState !== 1) return
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_LOADED)
  encoding.writeVarString(encoder, String(loadedAt))
  conn.send(encoding.toUint8Array(encoder))
}

function sendSaveError(conn) {
  if (conn.readyState !== 1) return
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SAVE_ERROR)
  conn.send(encoding.toUint8Array(encoder))
}

function scheduleSave(entry, delay = SAVE_DEBOUNCE_MS) {
  if (!entry.room.startsWith('note:')) return
  clearTimeout(entry.saveTimer)
  entry.saveTimer = setTimeout(() => {
    entry.saveTimer = null
    saveRoom(entry)
  }, delay)
}

function saveRoom(entry) {
  if (!entry.room.startsWith('note:')) return
  const noteId = entry.room.slice(5)
  try {
    const update = Y.encodeStateAsUpdate(entry.doc)
    const meta = entry.doc.getMap('meta').toJSON()
    const updatedAt = Number(meta.updatedAt) || Date.now()
    const trashed = meta.trashed ? 1 : 0
    const existing = db.prepare('SELECT trashed, trashed_at FROM notes WHERE id = ?').get(noteId)
    if (!existing) {
      // The note was deleted while this room was still open. There is nothing
      // left to persist, but the server must not acknowledge a save.
      entry.pendingWriters.clear()
      return
    }
    // Keep the original trash date if the note is edited while in the trash.
    const trashedAt = trashed
      ? existing.trashed === 1 && existing.trashed_at > 0
        ? existing.trashed_at
        : Date.now()
      : 0
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
      `UPDATE notes SET content = ?, title = ?, due = ?, starred = ?, trashed = ?, trashed_at = ?, updated_at = ?, text = ?, tags = ?, parent_id = ?
       WHERE id = ?`,
    ).run(
      Buffer.from(update),
      typeof meta.title === 'string' ? meta.title : '',
      typeof meta.due === 'string' && meta.due ? meta.due : null,
      meta.starred ? 1 : 0,
      trashed,
      trashedAt,
      updatedAt,
      text.slice(0, 20_000),
      JSON.stringify(Array.isArray(meta.tags) ? meta.tags.slice(0, 20) : []),
      typeof meta.parentId === 'string' && meta.parentId ? meta.parentId : null,
      noteId,
    )
    if (trashed) disconnectPublicRoom(noteId, 4403)

    const savedAt = Date.now()
    const writers = entry.pendingWriters
    entry.pendingWriters = new Set()
    for (const conn of writers) {
      if (conn.readyState === 1) sendSaveAck(conn, savedAt)
    }

    // Title, tags, date, star and trash state all live in the note list.
    pushNotesForNote(noteId)
  } catch (error) {
    console.error('[sync] could not persist note', noteId, error.message)
    for (const conn of entry.pendingWriters) sendSaveError(conn)
    // Keep the writes pending and retry while someone is still connected.
    if (entry.conns.size > 0) scheduleSave(entry, SAVE_RETRY_MS)
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
  const entry = {
    room,
    doc,
    awareness,
    conns: new Set(),
    saveTimer: null,
    pendingWriters: new Set(),
    snapshot: noteSnapshot(doc),
  }
  rooms.set(room, entry)

  doc.on('update', (update, origin) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    const message = encoding.toUint8Array(encoder)
    for (const conn of entry.conns) {
      if (conn !== origin && conn.readyState === 1) conn.send(message)
    }
    if (origin && entry.conns.has(origin)) entry.pendingWriters.add(origin)
    scheduleSave(entry)

    // Attribute this update to the connection that sent it. The snapshot from
    // just before the update gives an exact before/after for the activity log.
    if (entry.room.startsWith('note:')) {
      const after = noteSnapshot(entry.doc)
      if (origin && origin.user?.userId) {
        recordNoteHistory(entry.room.slice(5), origin.user, entry.snapshot, after)
      }
      entry.snapshot = after
    }
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

function closeWithoutAccess(conn, access) {
  conn.close(access.code ?? 4403, 'Access changed')
}

function applyClientUpdate(entry, conn, update) {
  let changed = false
  const onChange = () => {
    changed = true
  }
  entry.doc.on('update', onChange)
  try {
    Y.applyUpdate(entry.doc, update, conn)
  } finally {
    entry.doc.off('update', onChange)
  }

  if (changed) return
  if (entry.pendingWriters.size > 0) {
    // The document already contains this update but an earlier SQLite write
    // failed. Keep the new connection attached to the retry's acknowledgement.
    entry.pendingWriters.add(conn)
    if (!entry.saveTimer) scheduleSave(entry, SAVE_RETRY_MS)
    return
  }
  // The server already had this state and it is durable, so the client's local
  // pending edit can be acknowledged without waiting for a pointless DB write.
  sendSaveAck(conn, Date.now())
}

export function attachConnection(conn, room) {
  const access = connectionAuthorizer(conn)
  if (!access.read) {
    closeWithoutAccess(conn, access)
    return
  }

  const entry = getRoom(room)
  entry.conns.add(conn)
  conn.awarenessIds = new Set()
  notifyActivity()

  // 1. Hand the client the current document state. A writable client takes part
  // in the normal two-way Yjs handshake; a read-only client gets a one-way
  // update so the server never asks it to send local offline state.
  {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    if (access.write) {
      syncProtocol.writeSyncStep1(encoder, entry.doc)
    } else {
      syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(entry.doc))
    }
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

  // The copy just loaded is durable; the client can show a confirmed save
  // until it makes a local change. This is distinct from a save ack so a new
  // local seed is not mistaken for an already-committed document.
  sendLoaded(conn, Date.now())

  conn.on('message', (data) => {
    try {
      const current = connectionAuthorizer(conn)
      if (!current.read) {
        closeWithoutAccess(conn, current)
        return
      }

      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      const decoder = decoding.createDecoder(bytes)
      const messageType = decoding.readVarUint(decoder)

      if (messageType === MESSAGE_SYNC) {
        const syncType = decoding.readVarUint(decoder)

        if (syncType === syncProtocol.messageYjsSyncStep1) {
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, MESSAGE_SYNC)
          syncProtocol.writeSyncStep2(
            encoder,
            entry.doc,
            decoding.readVarUint8Array(decoder),
          )
          conn.send(encoding.toUint8Array(encoder))
          return
        }

        if (
          syncType === syncProtocol.messageYjsSyncStep2 ||
          syncType === syncProtocol.messageYjsUpdate
        ) {
          if (!current.write) {
            // Do not silently accept an edit the note's lock forbids. Closing
            // makes the provider reconnect in read-only mode instead of
            // leaving the user with an editor that looks saved but is not.
            conn.close(4003, 'Read-only note')
            return
          }
          applyClientUpdate(entry, conn, decoding.readVarUint8Array(decoder))
        }
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
    notifyActivity()
    if (conn.awarenessIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        entry.awareness,
        [...conn.awarenessIds],
        'disconnect',
      )
    }
    if (entry.conns.size === 0) {
      clearTimeout(entry.saveTimer)
      entry.saveTimer = null
      saveRoom(entry)
      // Keep the document warm briefly so quick reloads do not re-read SQLite.
      setTimeout(() => {
        const live = rooms.get(room)
        if (!live || live.conns.size > 0) return
        clearTimeout(live.saveTimer)
        live.saveTimer = null
        live.awareness.destroy()
        live.doc.destroy()
        rooms.delete(room)
        notifyActivity()
      }, ROOM_IDLE_MS).unref()
    }
  })

  conn.on('error', () => {})
}

/**
 * Replace a note with a historical snapshot in the live room, then persist it.
 * The HTTP layer has already checked write access; this only owns Yjs state.
 */
export function restoreNoteVersion(noteId, snapshot, user) {
  const entry = getRoom(`note:${noteId}`)
  const before = noteSnapshot(entry.doc)
  applyHistorySnapshot(entry.doc, snapshot)
  const after = noteSnapshot(entry.doc)
  recordNoteHistory(noteId, user, before, after)
  if (entry.conns.size === 0) {
    clearTimeout(entry.saveTimer)
    entry.saveTimer = null
    saveRoom(entry)
    entry.awareness.destroy()
    entry.doc.destroy()
    rooms.delete(entry.room)
    notifyActivity()
  }
  pushNotesForNote(noteId)
  return after
}

/** Recover one history entry from the live document and apply it. */
export function restoreHistoricalVersion(noteId, entryId, user) {
  const entry = getRoom(`note:${noteId}`)
  const snapshot = snapshotAtHistoryEntry(noteId, entryId, entry.doc)
  if (!snapshot) return null
  return restoreNoteVersion(noteId, snapshot, user)
}

/** Close public link connections without disturbing signed-in collaborators. */
export function disconnectPublicRoom(noteId, code = 4403) {
  const entry = rooms.get(`note:${noteId}`)
  if (!entry) return
  for (const conn of [...entry.conns]) {
    if (conn.publicShare) conn.close(code, 'Public link changed')
  }
}

/** Close every live connection to one user's note session. */
export function disconnectNoteUser(noteId, userId, code = 4403) {
  const entry = rooms.get(`note:${noteId}`)
  if (!entry) return
  for (const conn of [...entry.conns]) {
    if (conn.user?.userId === userId) conn.close(code, 'Access changed')
  }
}

/** Close every live connection to a note, e.g. when it is locked or deleted. */
export function disconnectNoteRoom(noteId, code = 4403) {
  const entry = rooms.get(`note:${noteId}`)
  if (!entry) return
  for (const conn of [...entry.conns]) conn.close(code, 'Access changed')
}

export function roomStats() {
  let connections = 0
  let noteRooms = 0
  let lobbyConnections = 0
  for (const entry of rooms.values()) {
    connections += entry.conns.size
    if (entry.room.startsWith('note:')) noteRooms += 1
    else lobbyConnections += entry.conns.size
  }
  return { rooms: rooms.size, noteRooms, connections, lobbyConnections }
}

export function closeAllRooms() {
  for (const entry of rooms.values()) {
    clearTimeout(entry.saveTimer)
    entry.saveTimer = null
    saveRoom(entry)
    entry.awareness.destroy()
    entry.doc.destroy()
  }
  rooms.clear()
}

/**
 * @typedef {{ room: string, doc: Y.Doc, awareness: awarenessProtocol.Awareness,
 *   conns: Set<import('ws').WebSocket>, saveTimer: NodeJS.Timeout | null,
 *   pendingWriters: Set<import('ws').WebSocket>,
 *   snapshot: ReturnType<typeof noteSnapshot> }} Room
 */
