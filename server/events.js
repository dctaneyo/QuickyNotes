import { db } from './db.js'

/** Every signed-in browser keeps one event socket open for pushed data. */
const subscribers = new Set()
let notesProvider = () => []
let templatesProvider = () => []
let adminProvider = () => null
let adminTimer = null

export function setNotesProvider(provider) {
  notesProvider = provider
}

export function setAdminProvider(provider) {
  adminProvider = provider
}

export function setTemplatesProvider(provider) {
  templatesProvider = provider
}

function isActiveAdmin(userId) {
  const row = db.prepare('SELECT is_admin, suspended_at FROM users WHERE user_id = ?').get(userId)
  return row?.is_admin === 1 && row.suspended_at === 0
}

export function attachEvents(ws) {
  subscribers.add(ws)
  ws.isAlive = true
  ws.on('pong', () => {
    ws.isAlive = true
  })
  ws.on('close', () => subscribers.delete(ws))
  ws.on('error', () => subscribers.delete(ws))
  ws.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!message || typeof message.type !== 'string') return
    if (message.type === 'admin:refresh') sendAdminSnapshot(ws)
    if (message.type === 'notes:refresh' && ws.user?.userId) pushNotes([ws.user.userId])
    if (message.type === 'templates:refresh' && ws.user?.userId) sendTemplatesSnapshot(ws)
  })
}

export function sendEvent(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload))
}

export function sendAdminSnapshot(ws) {
  if (!ws.user?.userId || !isActiveAdmin(ws.user.userId)) return
  const snapshot = adminProvider()
  if (snapshot) sendEvent(ws, { type: 'admin:snapshot', ...snapshot })
}

export function sendTemplatesSnapshot(ws) {
  if (!ws.user?.userId) return
  sendEvent(ws, {
    type: 'templates:snapshot',
    templates: templatesProvider(ws.user.userId),
  })
}

export function pushTemplates(userId) {
  if (!userId) return
  const payload = JSON.stringify({
    type: 'templates:snapshot',
    templates: templatesProvider(userId),
  })
  for (const ws of subscribers) {
    if (ws.user?.userId === userId && ws.readyState === 1) ws.send(payload)
  }
}

export function pushAdminSnapshot() {
  const snapshot = adminProvider()
  if (!snapshot) return
  for (const ws of subscribers) {
    if (ws.user?.userId && isActiveAdmin(ws.user.userId)) {
      sendEvent(ws, { type: 'admin:snapshot', ...snapshot })
    }
  }
}

/** Coalesce bursts (room joins, note saves) into one admin update. */
export function scheduleAdminPush() {
  if (adminTimer) return
  adminTimer = setTimeout(() => {
    adminTimer = null
    pushAdminSnapshot()
  }, 250)
  adminTimer.unref?.()
}

export function pushNotes(userIds) {
  for (const userId of new Set(userIds)) {
    if (!userId) continue
    const payload = JSON.stringify({ type: 'notes:snapshot', notes: notesProvider(userId) })
    for (const ws of subscribers) {
      if (ws.user?.userId === userId && ws.readyState === 1) ws.send(payload)
    }
  }
}

export function noteAudience(noteId) {
  const note = db.prepare('SELECT owner_id FROM notes WHERE id = ?').get(noteId)
  if (!note) return []
  const members = db.prepare('SELECT user_id FROM note_members WHERE note_id = ?').all(noteId)
  return [note.owner_id, ...members.map((row) => row.user_id)]
}

export function pushNotesForNote(noteId) {
  pushNotes(noteAudience(noteId))
}

/** One note's comments changed; only its audience needs to refetch. */
export function pushComments(noteId) {
  const audience = new Set(noteAudience(noteId))
  if (audience.size === 0) return
  const payload = JSON.stringify({ type: 'comments:changed', noteId })
  for (const ws of subscribers) {
    if (ws.user?.userId && audience.has(ws.user.userId) && ws.readyState === 1) {
      ws.send(payload)
    }
  }
}

/** Tell mentioned people to refresh their mention inbox. */
export function pushMentions(userIds) {
  const audience = new Set(userIds)
  if (audience.size === 0) return
  const payload = JSON.stringify({ type: 'mentions:changed' })
  for (const ws of subscribers) {
    if (ws.user?.userId && audience.has(ws.user.userId) && ws.readyState === 1) {
      ws.send(payload)
    }
  }
}

/** One note's history changed; only its audience needs to refetch. */
export function pushNoteHistory(noteId) {
  const audience = new Set(noteAudience(noteId))
  if (audience.size === 0) return
  const payload = JSON.stringify({ type: 'history:changed', noteId })
  for (const ws of subscribers) {
    if (ws.user?.userId && audience.has(ws.user.userId) && ws.readyState === 1) {
      ws.send(payload)
    }
  }
}

/** Refresh the lists of everyone who shares a note with this person. */
export function pushNotesForUser(userId) {
  const noteIds = new Set()
  for (const row of db.prepare('SELECT id FROM notes WHERE owner_id = ?').all(userId)) {
    noteIds.add(row.id)
  }
  for (const row of db.prepare('SELECT note_id FROM note_members WHERE user_id = ?').all(userId)) {
    noteIds.add(row.note_id)
  }
  const users = new Set([userId])
  for (const noteId of noteIds) {
    for (const id of noteAudience(noteId)) users.add(id)
  }
  pushNotes([...users])
}

// Detect half-open sockets without asking the browser to poll.
const heartbeat = setInterval(() => {
  for (const ws of subscribers) {
    if (ws.isAlive === false) {
      ws.terminate()
      subscribers.delete(ws)
      continue
    }
    ws.isAlive = false
    try {
      ws.ping()
    } catch {
      subscribers.delete(ws)
    }
  }
}, 30_000)
heartbeat.unref?.()
