import express from 'express'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import { noteSnapshot } from './history.js'
import {
  db,
  countUsers,
  databasePath,
  getSetting,
  purgeExpiredSessions,
  setSetting,
  storage,
} from './db.js'
import {
  PIN_RE,
  USER_ID_RE,
  bearerToken,
  clearFailures,
  createSession,
  findUser,
  generateUserId,
  hashPin,
  hashToken,
  publicUser,
  registerFailure,
  requireAdmin,
  requireAuth,
  sessionIsActive,
  throttleIp,
  userForToken,
  verifyPin,
} from './auth.js'
import {
  attachConnection,
  closeAllRooms,
  disconnectNoteRoom,
  disconnectNoteUser,
  disconnectPublicRoom,
  onRoomActivity,
  restoreHistoricalVersion,
  roomStats,
  setConnectionAuthorizer,
  setUpdateAuthorizer,
} from './realtime.js'
import {
  attachEvents,
  noteAudience,
  pushAdminSnapshot,
  pushComments,
  pushMentions,
  pushNotes,
  pushNotesForNote,
  pushNotesForUser,
  pushTemplates,
  scheduleAdminPush,
  sendAdminSnapshot,
  sendEvent,
  sendTemplatesSnapshot,
  setAdminProvider,
  setNotesProvider,
  setTemplatesProvider,
} from './events.js'

const app = express()
const server = http.createServer(app)
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false'
const DIST_DIR = path.join(process.cwd(), 'dist')
const TRASH_RETENTION_DAYS = 10
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
const TRASH_SWEEP_MS = Math.max(250, Number(process.env.TRASH_SWEEP_MS) || 60 * 60 * 1000)
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version
  } catch {
    return '0.1.0'
  }
})()

app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(express.json({ limit: '300kb' }))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('X-Frame-Options', 'DENY')
  next()
})

const route = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)

// Signups follow ALLOW_SIGNUP until an admin flips the switch in the console.
function signupsEnabled() {
  const stored = getSetting('signups')
  return stored === null ? ALLOW_SIGNUP : stored === 'open'
}

function logAdmin(actorId, targetId, action, detail = '') {
  db.prepare(
    'INSERT INTO admin_audit (actor_id, target_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(actorId, targetId, action, detail, Date.now())
}

function adminCount() {
  return db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get().count
}

function activeAdminCount() {
  return db
    .prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1 AND suspended_at = 0')
    .get().count
}

// ---------------------------------------------------------------- auth -------

app.use('/api/auth', (req, res, next) => {
  if (req.method === 'GET') return next()
  const limit = throttleIp(req.ip || 'unknown')
  if (limit.blocked) {
    res
      .status(429)
      .json({ error: 'Too many attempts from this network. Try again shortly.', retryAfter: limit.retryAfter })
    return
  }
  next()
})

// Public: lets the login screen hide account creation when signups are closed.
app.get('/api/auth/signups', (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ enabled: signupsEnabled() })
})

app.post(
  '/api/auth/signup',
  route(async (req, res) => {
    if (!signupsEnabled()) {
      res.status(403).json({ error: "New accounts aren't being accepted at this time." })
      return
    }
    const pin = String(req.body?.pin ?? '')
    if (!PIN_RE.test(pin)) {
      res.status(400).json({ error: 'Choose a 6-digit PIN.' })
      return
    }
    const requestedName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : ''
    if (!requestedName) {
      res.status(400).json({ error: 'Enter a display name for your account.' })
      return
    }
    const userId = generateUserId()
    const isAdmin = countUsers() === 0
    db.prepare(
      `INSERT INTO users (user_id, pin_hash, display_name, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      userId,
      await hashPin(pin),
      requestedName.slice(0, 40),
      isAdmin ? 1 : 0,
      Date.now(),
    )
    const session = createSession(userId)
    scheduleAdminPush()
    res.status(201).json({
      token: session.token,
      user: publicUser(findUser(userId)),
      firstAccount: isAdmin,
    })
  }),
)

app.post(
  '/api/auth/login',
  route(async (req, res) => {
    const userId = String(req.body?.userId ?? '')
    const pin = String(req.body?.pin ?? '')
    if (!USER_ID_RE.test(userId) || !PIN_RE.test(pin)) {
      res.status(400).json({ error: 'Enter your 8-digit ID and 6-digit PIN.' })
      return
    }
    const row = findUser(userId)
    if (!row) {
      res.status(401).json({ error: 'That ID and PIN do not match.', remaining: 4 })
      return
    }
    if (row.suspended_at > 0) {
      res.status(403).json({ error: 'This account is suspended. Ask an admin to restore it.' })
      return
    }
    if (row.locked_until > Date.now()) {
      res.status(429).json({
        error: 'Too many tries. This account is locked for a few minutes.',
        retryAfter: Math.ceil((row.locked_until - Date.now()) / 1000),
      })
      return
    }
    const ok = await verifyPin(pin, row.pin_hash)
    if (!ok) {
      const failure = registerFailure(row)
      res.status(failure.lockedForMs ? 429 : 401).json({
        error: failure.lockedForMs
          ? 'Five wrong tries. Locked for 5 minutes.'
          : 'That ID and PIN do not match.',
        remaining: failure.remaining,
        retryAfter: Math.ceil(failure.lockedForMs / 1000),
      })
      return
    }
    clearFailures(userId)
    const session = createSession(userId)
    scheduleAdminPush()
    res.json({ token: session.token, user: publicUser(row) })
  }),
)

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(bearerToken(req)))
  disconnectUser(req.user.user_id, 4401)
  scheduleAdminPush()
  res.json({ ok: true })
})

app.post(
  '/api/auth/pin',
  requireAuth,
  route(async (req, res) => {
    const currentPin = String(req.body?.currentPin ?? '')
    const newPin = String(req.body?.newPin ?? '')
    if (!PIN_RE.test(newPin)) {
      res.status(400).json({ error: 'The new PIN must be 6 digits.' })
      return
    }
    if (!(await verifyPin(currentPin, req.user.pin_hash))) {
      res.status(401).json({ error: 'That current PIN is not right.' })
      return
    }
    db.prepare('UPDATE users SET pin_hash = ? WHERE user_id = ?').run(
      await hashPin(newPin),
      req.user.user_id,
    )
    // Other devices signed in with the old PIN are signed out. Keep this
    // browser's session, but tear down every other live socket immediately.
    const currentSession = hashToken(bearerToken(req))
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(
      req.user.user_id,
      currentSession,
    )
    disconnectUser(req.user.user_id, 4401, currentSession)
    scheduleAdminPush()
    res.json({ ok: true })
  }),
)

app.patch('/api/auth/me', requireAuth, (req, res) => {
  const name = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : ''
  if (!name) {
    res.status(400).json({ error: 'Enter a name.' })
    return
  }
  db.prepare('UPDATE users SET display_name = ? WHERE user_id = ?').run(
    name.slice(0, 40),
    req.user.user_id,
  )
  pushNotesForUser(req.user.user_id)
  scheduleAdminPush()
  res.json({ user: publicUser(findUser(req.user.user_id)) })
})

// People can be found by name or ID so nobody has to memorise eight digits.
app.get('/api/users/search', requireAuth, (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (query.length < 2) {
    res.json({ users: [] })
    return
  }
  const like = `%${query}%`
  const rows = db
    .prepare(
      `SELECT user_id, display_name FROM users
       WHERE suspended_at = 0 AND user_id <> ? AND (user_id LIKE ? OR display_name LIKE ?)
       ORDER BY display_name COLLATE NOCASE LIMIT 8`,
    )
    .all(req.user.user_id, like, like)
  res.json({
    users: rows.map((row) => ({ userId: row.user_id, displayName: row.display_name })),
  })
})

// --------------------------------------------------------------- notes -------

function permissionsFor(role, canComment) {
  return {
    edit: role === 'owner' || role === 'editor',
    comment: role === 'owner' || canComment !== 0,
  }
}

function accessFor(noteId, userId) {
  const row = db
    .prepare(
      `SELECT n.owner_id,
              CASE WHEN n.owner_id = ? THEN 'owner'
                   ELSE (SELECT role FROM note_members m WHERE m.note_id = n.id AND m.user_id = ?)
              END AS role,
              (SELECT can_comment FROM note_members m
               WHERE m.note_id = n.id AND m.user_id = ?) AS can_comment
       FROM notes n WHERE n.id = ?`,
    )
    .get(userId, userId, userId, noteId)
  if (!row) return null
  return {
    ownerId: row.owner_id,
    role: row.role ?? null,
    permissions: permissionsFor(row.role, row.can_comment),
  }
}

function cleanMemberPermissions(body, fallback = { edit: true, comment: true }) {
  const source =
    body?.permissions && typeof body.permissions === 'object' ? body.permissions : null
  const role = body?.role === 'viewer' ? 'viewer' : body?.role === 'editor' ? 'editor' : null
  const edit =
    typeof source?.edit === 'boolean' ? source.edit : role ? role === 'editor' : fallback.edit
  const comment =
    typeof source?.comment === 'boolean' ? source.comment : fallback.comment
  return { role: edit ? 'editor' : 'viewer', canComment: comment ? 1 : 0 }
}

function parseTags(raw) {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === 'string') : []
  } catch {
    return []
  }
}

// ----------------------------------------------------------- templates -------

const TEMPLATE_BLOCK_TYPES = new Set([
  'text',
  'h1',
  'h2',
  'h3',
  'bullet',
  'number',
  'todo',
  'quote',
  'code',
  'callout',
  'divider',
])
const MAX_TEMPLATES = 50
const MAX_TEMPLATE_BLOCKS = 200

function cleanTemplateTags(raw) {
  if (!Array.isArray(raw)) return []
  const tags = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const tag = value.trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 24)
    if (tag && !tags.includes(tag)) tags.push(tag)
    if (tags.length >= 20) break
  }
  return tags
}

function cleanTemplateFormat(raw) {
  if (!raw || typeof raw !== 'object') return null
  const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : null
  const highlight =
    typeof raw.highlight === 'string' && /^#[0-9a-f]{6}$/i.test(raw.highlight)
      ? raw.highlight
      : null
  const size = Number(raw.fontSize)
  return {
    bold: raw.bold === true,
    italic: raw.italic === true,
    underline: raw.underline === true,
    strike: raw.strike === true,
    fontSize:
      Number.isFinite(size) && size > 0
        ? Math.min(48, Math.max(11, Math.round(size)))
        : null,
    color,
    highlight,
  }
}

function cleanTemplateBlocks(raw) {
  if (!Array.isArray(raw)) raw = []
  const blocks = []
  for (const value of raw.slice(0, MAX_TEMPLATE_BLOCKS)) {
    if (!value || typeof value !== 'object') continue
    if (typeof value.type !== 'string' || !TEMPLATE_BLOCK_TYPES.has(value.type)) continue
    blocks.push({
      type: value.type,
      text: typeof value.text === 'string' ? value.text.slice(0, 20_000) : '',
      checked: value.checked === true,
      indent: Math.min(3, Math.max(0, Number(value.indent) || 0)),
      format: cleanTemplateFormat(value.format),
    })
  }
  // A template always has somewhere to type.
  if (blocks.length === 0) blocks.push({ type: 'text', text: '', checked: false, indent: 0 })
  return blocks
}

function parseTemplateBlocks(raw) {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mapTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    tags: parseTags(row.tags),
    blocks: parseTemplateBlocks(row.blocks),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function listTemplatesForUser(userId) {
  return db
    .prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId)
    .map(mapTemplate)
}

// Older saves rounded a default font size down to the 11px minimum. Repair
// those rows once so notes created from saved templates keep natural sizes.
function repairTemplateFontSizes() {
  if (getSetting('template_font_size_repair') === '1') return
  try {
    const rows = db.prepare('SELECT id, blocks FROM templates').all()
    const update = db.prepare('UPDATE templates SET blocks = ? WHERE id = ?')
    let changed = 0
    for (const row of rows) {
      let blocks
      try {
        blocks = JSON.parse(row.blocks || '[]')
      } catch {
        continue
      }
      if (!Array.isArray(blocks)) continue
      let touched = false
      const next = blocks.map((block) => {
        if (!block || typeof block !== 'object' || !block.format) return block
        if (Number(block.format.fontSize) !== 11) return block
        touched = true
        return { ...block, format: { ...block.format, fontSize: null } }
      })
      if (!touched) continue
      update.run(JSON.stringify(next), row.id)
      changed += 1
    }
    setSetting('template_font_size_repair', '1')
    if (changed > 0) {
      console.log(
        `[quicky] repaired font size in ${changed} template${changed === 1 ? '' : 's'}`,
      )
    }
  } catch (error) {
    console.error('[quicky] could not repair template font sizes', error.message)
  }
}

repairTemplateFontSizes()

function mapNote(row) {
  return {
    id: row.id,
    title: row.title,
    due: row.due,
    tags: parseTags(row.tags),
    starred: row.starred === 1,
    trashed: row.trashed === 1,
    trashedAt: row.trashed_at ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    role: row.role,
    permissions: permissionsFor(row.role, row.can_comment),
    memberCount: row.member_count ?? 1,
    locked: row.locked === 1,
    lockProtected: row.lock_protected === 1,
    parentId: row.parent_id ?? null,
    publicToken: row.role === 'owner' ? row.public_token ?? null : null,
    text: row.text ?? '',
  }
}

function membersOf(noteId) {
  const note = db
    .prepare(
      `SELECT n.owner_id, u.display_name FROM notes n JOIN users u ON u.user_id = n.owner_id WHERE n.id = ?`,
    )
    .get(noteId)
  if (!note) return []
  const rest = db
    .prepare(
      `SELECT m.user_id, m.role, m.can_comment, u.display_name
       FROM note_members m JOIN users u ON u.user_id = m.user_id
       WHERE m.note_id = ? ORDER BY u.display_name COLLATE NOCASE`,
    )
    .all(noteId)
  return [
    {
      userId: note.owner_id,
      displayName: note.display_name,
      role: 'owner',
      permissions: { edit: true, comment: true },
    },
    ...rest.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      role: row.role,
      permissions: permissionsFor(row.role, row.can_comment),
    })),
  ]
}

function listNotesForUser(userId, query = '') {
  const params = [userId, userId, userId]
  let sql = `
    SELECT n.*, u.display_name AS owner_name,
           CASE WHEN n.owner_id = ? THEN 'owner' ELSE m.role END AS role,
           m.can_comment,
           1 + (SELECT COUNT(*) FROM note_members mc WHERE mc.note_id = n.id) AS member_count,
           (l.note_id IS NOT NULL) AS locked,
           (l.password_hash IS NOT NULL) AS lock_protected
    FROM notes n
    JOIN users u ON u.user_id = n.owner_id
    LEFT JOIN note_locks l ON l.note_id = n.id
    LEFT JOIN note_members m ON m.note_id = n.id AND m.user_id = ?
    WHERE (n.owner_id = ? OR m.user_id IS NOT NULL)`
  if (query) {
    sql += ' AND (n.title LIKE ? OR n.text LIKE ?)'
    params.push(`%${query}%`, `%${query}%`)
  }
  sql += ' ORDER BY n.updated_at DESC'
  const notes = db.prepare(sql).all(...params).map(mapNote)
  if (notes.length === 0) return notes
  const memberRows = db
    .prepare(
      `SELECT m.note_id, m.user_id, m.role, m.can_comment, u.display_name
       FROM note_members m JOIN users u ON u.user_id = m.user_id
       WHERE m.note_id IN (${notes.map(() => '?').join(',')})
       ORDER BY u.display_name COLLATE NOCASE`,
    )
    .all(...notes.map((note) => note.id))
  const extras = new Map()
  for (const row of memberRows) {
    if (!extras.has(row.note_id)) extras.set(row.note_id, [])
    extras.get(row.note_id).push({
      userId: row.user_id,
      displayName: row.display_name,
      role: row.role,
      permissions: permissionsFor(row.role, row.can_comment),
    })
  }
  return notes.map((note) => ({
    ...note,
    members: [
      {
        userId: note.ownerId,
        displayName: note.ownerName,
        role: 'owner',
        permissions: { edit: true, comment: true },
      },
      ...(extras.get(note.id) ?? []),
    ],
  }))
}

app.get('/api/notes', requireAuth, (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  res.json({ notes: listNotesForUser(req.user.user_id, query) })
})

function mapComment(row) {
  const mentions = db
    .prepare(
      `SELECT cm.user_id, u.display_name
       FROM comment_mentions cm JOIN users u ON u.user_id = cm.user_id
       WHERE cm.comment_id = ? ORDER BY u.display_name COLLATE NOCASE`,
    )
    .all(row.id)
    .map((mention) => ({ userId: mention.user_id, displayName: mention.display_name }))
  return {
    id: row.id,
    noteId: row.note_id,
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.body,
    resolvedAt: row.resolved_at ?? 0,
    createdAt: row.created_at,
    mentions,
  }
}

function listComments(noteId) {
  return db
    .prepare('SELECT * FROM note_comments WHERE note_id = ? ORDER BY created_at ASC')
    .all(noteId)
    .map(mapComment)
}

function notificationInbox(userId, limit = 40) {
  const rows = db
    .prepare(
      `SELECT c.*, n.title, n.trashed, cn.read_at AS notification_read_at,
              EXISTS (
                SELECT 1 FROM comment_mentions cm
                WHERE cm.comment_id = c.id AND cm.user_id = ?
              ) AS mentioned
       FROM comment_notifications cn
       JOIN note_comments c ON c.id = cn.comment_id
       JOIN notes n ON n.id = c.note_id
       WHERE cn.user_id = ? AND n.trashed = 0
         AND (n.owner_id = ? OR EXISTS (
           SELECT 1 FROM note_members m WHERE m.note_id = n.id AND m.user_id = ?
         ))
       ORDER BY c.created_at DESC LIMIT ?`,
    )
    .all(userId, userId, userId, userId, limit)
  return rows.map((row) => ({
    id: row.id,
    noteId: row.note_id,
    noteTitle: row.title,
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.notification_read_at ?? 0,
    mentioned: row.mentioned === 1,
  }))
}

app.get('/api/notes/export', requireAuth, (req, res) => {
  const notes = listNotesForUser(req.user.user_id)
    .filter((note) => !note.trashed)
    .map((summary) => {
      const row = db.prepare('SELECT content FROM notes WHERE id = ?').get(summary.id)
      const blockDoc = new Y.Doc()
      if (row?.content) Y.applyUpdate(blockDoc, new Uint8Array(row.content))
      const snapshot = noteSnapshot(blockDoc)
      blockDoc.destroy()
      return {
        id: summary.id,
        title: snapshot.title || summary.title,
        due: summary.due,
        tags: summary.tags,
        starred: summary.starred,
        parentId: summary.parentId,
        blocks: snapshot.blocks.map(({ type, text, checked, indent, format }) => ({
          type,
          text,
          checked,
          indent,
          format,
        })),
      }
    })
  res.set('Cache-Control', 'no-store')
  res
    .type('application/json')
    .set('Content-Disposition', 'attachment; filename="quicky-notes-export.json"')
    .send(JSON.stringify({ version: 1, exportedAt: Date.now(), notes }, null, 2))
})

app.get('/api/notes/:id/comments', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store')
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access?.role) {
    res.status(404).json({ error: 'That note does not exist for you.' })
    return
  }
  res.json({ comments: listComments(req.params.id) })
})

app.post('/api/notes/:id/comments', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access?.role) {
    res.status(404).json({ error: 'That note does not exist for you.' })
    return
  }
  if (!access.permissions.comment) {
    res.status(403).json({ error: 'The note owner has turned off comments for you.' })
    return
  }
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
  if (!body) {
    res.status(400).json({ error: 'Write a comment first.' })
    return
  }
  if (body.length > 4000) {
    res.status(400).json({ error: 'Comments can be up to 4,000 characters.' })
    return
  }
  const allowed = new Set(noteAudience(req.params.id))
  allowed.delete(req.user.user_id)
  const requested = Array.isArray(req.body?.mentions) ? req.body.mentions : []
  const mentionIds = [
    ...new Set(
      requested.filter(
        (value) => typeof value === 'string' && USER_ID_RE.test(value) && allowed.has(value),
      ),
    ),
  ]
  const id = randomUUID()
  const now = Date.now()
  const notifiedIds = [...allowed]
  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT INTO note_comments (id, note_id, author_id, author_name, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, req.params.id, req.user.user_id, req.user.display_name, body, now)
    for (const userId of notifiedIds) {
      db.prepare(
        'INSERT INTO comment_notifications (comment_id, user_id) VALUES (?, ?)',
      ).run(id, userId)
    }
    for (const userId of mentionIds) {
      db.prepare('INSERT INTO comment_mentions (comment_id, user_id) VALUES (?, ?)').run(
        id,
        userId,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  pushComments(req.params.id)
  pushMentions(notifiedIds)
  res.status(201).json({ comment: mapComment(db.prepare('SELECT * FROM note_comments WHERE id = ?').get(id)) })
})

app.patch('/api/notes/:id/comments/:commentId', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access?.role) {
    res.status(404).json({ error: 'That note does not exist for you.' })
    return
  }
  const row = db
    .prepare('SELECT * FROM note_comments WHERE id = ? AND note_id = ?')
    .get(req.params.commentId, req.params.id)
  if (!row) {
    res.status(404).json({ error: 'That comment does not exist.' })
    return
  }
  if (!access.permissions.comment) {
    res.status(403).json({ error: 'The note owner has turned off comments for you.' })
    return
  }
  if (row.author_id !== req.user.user_id && access.role !== 'owner') {
    res.status(403).json({ error: 'Only the author or note owner can resolve this comment.' })
    return
  }
  const resolved = req.body?.resolved === true
  db.prepare('UPDATE note_comments SET resolved_at = ? WHERE id = ?').run(
    resolved ? Date.now() : 0,
    row.id,
  )
  pushComments(req.params.id)
  res.json({ comment: mapComment(db.prepare('SELECT * FROM note_comments WHERE id = ?').get(row.id)) })
})

app.delete('/api/notes/:id/comments/:commentId', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access?.role) {
    res.status(404).json({ error: 'That note does not exist for you.' })
    return
  }
  const row = db
    .prepare('SELECT * FROM note_comments WHERE id = ? AND note_id = ?')
    .get(req.params.commentId, req.params.id)
  if (!row) {
    res.status(404).json({ error: 'That comment does not exist.' })
    return
  }
  if (!access.permissions.comment) {
    res.status(403).json({ error: 'The note owner has turned off comments for you.' })
    return
  }
  if (row.author_id !== req.user.user_id && access.role !== 'owner') {
    res.status(403).json({ error: 'Only the author or note owner can delete this comment.' })
    return
  }
  const notified = db
    .prepare('SELECT user_id FROM comment_notifications WHERE comment_id = ?')
    .all(row.id)
    .map((entry) => entry.user_id)
  db.prepare('DELETE FROM note_comments WHERE id = ?').run(row.id)
  pushComments(req.params.id)
  pushMentions(notified)
  res.json({ ok: true })
})

app.get('/api/mentions', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store')
  const mentions = notificationInbox(req.user.user_id)
  res.json({ mentions, unread: mentions.filter((mention) => !mention.readAt).length })
})

app.post('/api/mentions/read', requireAuth, (req, res) => {
  const ids = Array.isArray(req.body?.commentIds)
    ? req.body.commentIds.filter((value) => typeof value === 'string').slice(0, 100)
    : []
  if (ids.length === 0) {
    db.prepare(
      'UPDATE comment_notifications SET read_at = ? WHERE user_id = ? AND read_at = 0',
    ).run(Date.now(), req.user.user_id)
  } else {
    const placeholders = ids.map(() => '?').join(',')
    db.prepare(
      `UPDATE comment_notifications SET read_at = ?
       WHERE user_id = ? AND comment_id IN (${placeholders})`,
    ).run(Date.now(), req.user.user_id, ...ids)
  }
  res.json({ ok: true })
})

app.get('/api/public/notes/:token', (req, res) => {
  res.set('Cache-Control', 'no-store')
  const row = db
    .prepare(
      `SELECT n.*, u.display_name AS owner_name,
              (l.note_id IS NOT NULL) AS locked
       FROM notes n
       JOIN users u ON u.user_id = n.owner_id
       LEFT JOIN note_locks l ON l.note_id = n.id
       WHERE n.public_token = ? AND n.trashed = 0`,
    )
    .get(req.params.token)
  if (!row) {
    res.status(404).json({ error: 'This public link is no longer available.' })
    return
  }
  res.json({
    note: {
      id: row.id,
      title: row.title,
      due: row.due,
      tags: parseTags(row.tags),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ownerName: row.owner_name,
      locked: row.locked === 1,
      text: row.text ?? '',
      content: row.content ? Buffer.from(row.content).toString('base64') : null,
    },
  })
})

app.post('/api/notes', requireAuth, (req, res) => {
  const id = String(req.body?.id ?? '')
  if (!/^[A-Za-z0-9:_-]{8,80}$/.test(id)) {
    res.status(400).json({ error: 'That note id is not valid.' })
    return
  }
  const existing = accessFor(id, req.user.user_id)
  if (existing) {
    if (!existing.role) {
      res.status(403).json({ error: 'You do not have access to that note.' })
      return
    }
    res.json({ created: false })
    return
  }
  const requestedParent = typeof req.body?.parentId === 'string' ? req.body.parentId : null
  if (requestedParent) {
    const parent = accessFor(requestedParent, req.user.user_id)
    if (!parent?.role) {
      res.status(400).json({ error: 'That parent note does not exist for you.' })
      return
    }
  }
  db.prepare(
    `INSERT INTO notes (id, owner_id, title, parent_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.user.user_id,
    String(req.body?.title ?? '').slice(0, 200),
    requestedParent,
    Date.now(),
    Date.now(),
  )
  pushNotesForNote(id)
  scheduleAdminPush()
  res.status(201).json({ created: true })
})

app.get('/api/notes/:id', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access?.role) {
    res.status(404).json({ error: 'That note does not exist for you.' })
    return
  }
  const row = db
    .prepare(
      `SELECT n.*, u.display_name AS owner_name,
              (l.note_id IS NOT NULL) AS locked,
              (l.password_hash IS NOT NULL) AS lock_protected
       FROM notes n
       JOIN users u ON u.user_id = n.owner_id
       LEFT JOIN note_locks l ON l.note_id = n.id
       WHERE n.id = ?`,
    )
    .get(req.params.id)
  res.json({
    note: mapNote({
      ...row,
      role: access.role,
      can_comment: access.permissions.comment ? 1 : 0,
      member_count: membersOf(row.id).length,
    }),
    members: membersOf(row.id),
  })
})

app.get('/api/notes/:id/history', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store')
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access?.role) {
    res.status(404).json({ error: 'That note does not exist for you.' })
    return
  }
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
  const rows = db
    .prepare(
      `SELECT id, actor_id, actor_name, created_at, changes FROM note_history
       WHERE note_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(req.params.id, limit)
  res.json({
    entries: rows.map((row) => {
      let changes = []
      try {
        const parsed = JSON.parse(row.changes)
        if (Array.isArray(parsed)) changes = parsed
      } catch {
        changes = []
      }
      return {
        id: row.id,
        actorId: row.actor_id,
        actorName: row.actor_name,
        createdAt: row.created_at,
        changes,
      }
    }),
  })
})

app.post('/api/notes/:id/history/:entryId/restore', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access?.permissions.edit) {
    res.status(403).json({ error: 'You do not have permission to restore this note.' })
    return
  }
  if (!canWriteNote(req.params.id, hashToken(bearerToken(req)))) {
    res.status(403).json({ error: 'Unlock this note before restoring a version.' })
    return
  }
  const entryId = Number(req.params.entryId)
  if (!Number.isInteger(entryId)) {
    res.status(400).json({ error: 'That history entry is not valid.' })
    return
  }
  const snapshot = restoreHistoricalVersion(req.params.id, entryId, req.user)
  if (!snapshot) {
    res.status(404).json({ error: 'That history entry is no longer available.' })
    return
  }
  res.json({
    ok: true,
    title: snapshot.title,
    blocks: snapshot.blocks.length,
    restoredAt: Date.now(),
  })
})

app.delete('/api/notes/trash', requireAuth, (req, res) => {
  const userId = req.user.user_id
  const rows = db
    .prepare(
      `SELECT n.id, n.owner_id
       FROM notes n
       LEFT JOIN note_members m ON m.note_id = n.id AND m.user_id = ?
       WHERE n.trashed = 1 AND (n.owner_id = ? OR m.user_id IS NOT NULL)`,
    )
    .all(userId, userId)
  if (rows.length === 0) {
    res.json({ deleted: 0, removed: 0 })
    return
  }

  // Collect audiences before deleting so everyone's live list is refreshed.
  const audience = new Set([userId])
  for (const row of rows) {
    for (const id of noteAudience(row.id)) audience.add(id)
  }
  const owned = rows.filter((row) => row.owner_id === userId)
  const shared = rows.filter((row) => row.owner_id !== userId)

  db.exec('BEGIN')
  try {
    for (const row of owned) {
      db.prepare('DELETE FROM notes WHERE id = ?').run(row.id)
    }
    // Notes owned by someone else stay alive; emptying trash just removes this
    // person's access instead of destroying another account's note.
    for (const row of shared) {
      db.prepare('DELETE FROM note_members WHERE note_id = ? AND user_id = ?').run(
        row.id,
        userId,
      )
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  for (const row of owned) {
    revokeNoteUnlocksForNote(row.id)
    disconnectNoteRoom(row.id, 4403)
  }
  for (const row of shared) {
    revokeNoteUnlocksForUser(row.id, userId)
    disconnectNoteUser(row.id, userId, 4403)
  }

  pushNotes([...audience])
  scheduleAdminPush()
  res.json({ deleted: owned.length, removed: shared.length })
})

app.delete('/api/notes/:id', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access?.role) {
    res.status(404).json({ error: 'That note does not exist for you.' })
    return
  }
  const audience = noteAudience(req.params.id)
  if (access.role !== 'owner') {
    const row = db.prepare('SELECT trashed FROM notes WHERE id = ?').get(req.params.id)
    if (row?.trashed !== 1) {
      res.status(403).json({ error: 'Only the owner can delete this note.' })
      return
    }
    // A shared note belongs to its owner. Permanently deleting it from a
    // member's trash removes only that member's access.
    db.prepare('DELETE FROM note_members WHERE note_id = ? AND user_id = ?').run(
      req.params.id,
      req.user.user_id,
    )
    revokeNoteUnlocksForUser(req.params.id, req.user.user_id)
    disconnectNoteUser(req.params.id, req.user.user_id, 4403)
    pushNotes(audience)
    scheduleAdminPush()
    res.json({ ok: true, removed: true })
    return
  }
  revokeNoteUnlocksForNote(req.params.id)
  disconnectNoteRoom(req.params.id, 4403)
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id)
  pushNotes(audience)
  scheduleAdminPush()
  res.json({ ok: true })
})

app.post('/api/notes/:id/members', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access || access.role !== 'owner') {
    res.status(403).json({ error: 'Only the owner can invite people.' })
    return
  }
  const targetId = String(req.body?.userId ?? '').trim()
  if (!USER_ID_RE.test(targetId)) {
    res.status(400).json({ error: 'Enter the 8-digit ID of the person you want to invite.' })
    return
  }
  if (targetId === req.user.user_id) {
    res.status(400).json({ error: 'You are already on this note.' })
    return
  }
  const target = findUser(targetId)
  if (!target) {
    res.status(404).json({ error: 'No account has that ID.' })
    return
  }
  const { role, canComment } = cleanMemberPermissions(req.body)
  db.prepare(
    `INSERT INTO note_members (note_id, user_id, role, can_comment, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(note_id, user_id) DO UPDATE SET
       role = excluded.role, can_comment = excluded.can_comment`,
  ).run(req.params.id, targetId, role, canComment, Date.now())
  if (role === 'viewer') disconnectNoteUser(req.params.id, targetId, 4003)
  pushNotesForNote(req.params.id)
  scheduleAdminPush()
  res.json({ members: membersOf(req.params.id) })
})

app.delete('/api/notes/:id/members/:userId', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  const targetId = req.params.userId
  const isSelf = targetId === req.user.user_id
  if (!access?.role || (access.role !== 'owner' && !isSelf)) {
    res.status(403).json({ error: 'Only the owner can remove people.' })
    return
  }
  if (access.ownerId === targetId) {
    res.status(400).json({ error: 'The owner cannot be removed from their own note.' })
    return
  }
  const audience = noteAudience(req.params.id)
  db.prepare('DELETE FROM note_members WHERE note_id = ? AND user_id = ?').run(
    req.params.id,
    targetId,
  )
  revokeNoteUnlocksForUser(req.params.id, targetId)
  disconnectNoteUser(req.params.id, targetId, 4403)
  pushNotes(audience)
  scheduleAdminPush()
  res.json({ members: membersOf(req.params.id) })
})

app.patch('/api/notes/:id/members/:userId', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access || access.role !== 'owner') {
    res.status(403).json({ error: 'Only the owner can change someone’s role.' })
    return
  }
  const targetId = req.params.userId
  if (targetId === access.ownerId) {
    res.status(400).json({ error: 'The owner’s permissions cannot be changed.' })
    return
  }
  const existing = db
    .prepare('SELECT role, can_comment FROM note_members WHERE note_id = ? AND user_id = ?')
    .get(req.params.id, targetId)
  if (!existing) {
    res.status(404).json({ error: 'That person is not on this note.' })
    return
  }
  const { role, canComment } = cleanMemberPermissions(req.body, {
    edit: existing.role !== 'viewer',
    comment: existing.can_comment !== 0,
  })
  db.prepare(
    'UPDATE note_members SET role = ?, can_comment = ? WHERE note_id = ? AND user_id = ?',
  ).run(role, canComment, req.params.id, targetId)
  if (role === 'viewer') disconnectNoteUser(req.params.id, targetId, 4003)
  pushNotesForNote(req.params.id)
  res.json({ members: membersOf(req.params.id) })
})

app.post('/api/notes/:id/public', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access || access.role !== 'owner') {
    res.status(403).json({ error: 'Only the owner can manage a public link.' })
    return
  }
  const enabled = req.body?.enabled === true
  const row = db.prepare('SELECT public_token, trashed FROM notes WHERE id = ?').get(req.params.id)
  if (!row || row.trashed === 1) {
    res.status(400).json({ error: 'Restore this note before sharing it publicly.' })
    return
  }
  let token = row.public_token ?? null
  if (enabled) {
    token = token || randomUUID().replace(/-/g, '')
    db.prepare('UPDATE notes SET public_token = ? WHERE id = ?').run(token, req.params.id)
  } else {
    token = null
    db.prepare('UPDATE notes SET public_token = NULL WHERE id = ?').run(req.params.id)
    disconnectPublicRoom(req.params.id, 4403)
  }
  pushNotesForNote(req.params.id)
  res.json({ enabled, publicToken: token })
})

// ------------------------------------------------------------ note locks ----

const unlockAttempts = new Map()
const UNLOCK_WINDOW_MS = 5 * 60 * 1000
const UNLOCK_MAX_FAILURES = 5

function lockFor(noteId) {
  return db.prepare('SELECT password_hash FROM note_locks WHERE note_id = ?').get(noteId)
}

// Unlock grants are per browser session and per note. They live in memory so a
// restart re-locks every note, and they are revoked when the note is locked or
// when the user locks it again.
const noteUnlocks = new Map()
const NOTE_UNLOCK_TTL_MS = 12 * 60 * 60 * 1000

function unlockKey(noteId, sessionHash) {
  return `${noteId}:${sessionHash}`
}

function grantNoteUnlock(noteId, sessionHash, userId) {
  noteUnlocks.set(unlockKey(noteId, sessionHash), {
    noteId,
    sessionHash,
    userId,
    expiresAt: Date.now() + NOTE_UNLOCK_TTL_MS,
  })
}

function hasNoteUnlock(noteId, sessionHash) {
  const key = unlockKey(noteId, sessionHash)
  const grant = noteUnlocks.get(key)
  if (!grant) return false
  if (grant.expiresAt <= Date.now()) {
    noteUnlocks.delete(key)
    return false
  }
  return true
}

function revokeNoteUnlock(noteId, sessionHash) {
  return noteUnlocks.delete(unlockKey(noteId, sessionHash))
}

function revokeNoteUnlocksForNote(noteId) {
  for (const [key, grant] of noteUnlocks) {
    if (grant.noteId === noteId) noteUnlocks.delete(key)
  }
}

function revokeNoteUnlocksForUser(noteId, userId) {
  for (const [key, grant] of noteUnlocks) {
    if (grant.noteId === noteId && grant.userId === userId) noteUnlocks.delete(key)
  }
}

function canWriteNote(noteId, sessionHash) {
  if (!lockFor(noteId)) return true
  return hasNoteUnlock(noteId, sessionHash)
}

setInterval(() => {
  const now = Date.now()
  for (const [key, grant] of noteUnlocks) {
    if (grant.expiresAt <= now) noteUnlocks.delete(key)
  }
}, 10 * 60 * 1000).unref()

app.post(
  '/api/notes/:id/lock',
  requireAuth,
  route(async (req, res) => {
    const access = accessFor(req.params.id, req.user.user_id)
    if (!access?.role) {
      res.status(404).json({ error: 'That note does not exist for you.' })
      return
    }
    if (access.role !== 'owner') {
      res.status(403).json({ error: 'Only the owner can lock a note.' })
      return
    }
    const raw = typeof req.body?.password === 'string' ? req.body.password : ''
    const password = raw.trim() ? raw : ''
    if (password && (password.length < 4 || password.length > 128)) {
      res.status(400).json({ error: 'Use a password between 4 and 128 characters.' })
      return
    }
    const hash = password ? await hashPin(password) : null
    db.prepare(
      `INSERT INTO note_locks (note_id, password_hash, locked_at) VALUES (?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET password_hash = excluded.password_hash, locked_at = excluded.locked_at`,
    ).run(req.params.id, hash, Date.now())
    revokeNoteUnlocksForNote(req.params.id)
    disconnectNoteRoom(req.params.id, 4003)
    pushNotesForNote(req.params.id)
    res.json({ locked: true, lockProtected: Boolean(password) })
  }),
)

// Unlocking is a per-visit grant in the editor; the note itself stays locked.
app.post(
  '/api/notes/:id/unlock',
  requireAuth,
  route(async (req, res) => {
    const access = accessFor(req.params.id, req.user.user_id)
    if (!access?.role) {
      res.status(404).json({ error: 'That note does not exist for you.' })
      return
    }
    const lock = lockFor(req.params.id)
    if (!lock) {
      res.json({ ok: true, open: true })
      return
    }
    if (access.role === 'owner') {
      grantNoteUnlock(req.params.id, hashToken(bearerToken(req)), req.user.user_id)
      disconnectNoteUser(req.params.id, req.user.user_id, 4003)
      res.json({ ok: true })
      return
    }
    if (!lock.password_hash) {
      res.status(403).json({ error: 'Only the owner can unlock this note.' })
      return
    }
    const key = `${req.params.id}:${req.user.user_id}`
    const now = Date.now()
    const attempt = unlockAttempts.get(key)
    if (attempt && attempt.resetAt > now && attempt.count >= UNLOCK_MAX_FAILURES) {
      res.status(429).json({
        error: 'Too many tries. Wait a few minutes.',
        retryAfter: Math.ceil((attempt.resetAt - now) / 1000),
      })
      return
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    if (!(await verifyPin(password, lock.password_hash))) {
      unlockAttempts.set(key, {
        count: attempt && attempt.resetAt > now ? attempt.count + 1 : 1,
        resetAt: attempt && attempt.resetAt > now ? attempt.resetAt : now + UNLOCK_WINDOW_MS,
      })
      res.status(403).json({ error: 'That password is not right.' })
      return
    }
    unlockAttempts.delete(key)
    grantNoteUnlock(req.params.id, hashToken(bearerToken(req)), req.user.user_id)
    // Reconnect writable so any offline edits made while read-only are merged
    // through the normal Yjs handshake instead of remaining local-only.
    disconnectNoteUser(req.params.id, req.user.user_id, 4003)
    res.json({ ok: true })
  }),
)

app.delete('/api/notes/:id/unlock', requireAuth, (req, res) => {
  const removed = revokeNoteUnlock(req.params.id, hashToken(bearerToken(req)))
  if (removed) disconnectNoteUser(req.params.id, req.user.user_id, 4003)
  res.json({ ok: true })
})

app.delete('/api/notes/:id/lock', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access?.role) {
    res.status(404).json({ error: 'That note does not exist for you.' })
    return
  }
  if (access.role !== 'owner') {
    res.status(403).json({ error: 'Only the owner can remove a note lock.' })
    return
  }
  db.prepare('DELETE FROM note_locks WHERE note_id = ?').run(req.params.id)
  revokeNoteUnlocksForNote(req.params.id)
  disconnectNoteRoom(req.params.id, 4003)
  pushNotesForNote(req.params.id)
  res.json({ locked: false, lockProtected: false })
})

setInterval(() => {
  const now = Date.now()
  for (const [key, attempt] of unlockAttempts) if (attempt.resetAt <= now) unlockAttempts.delete(key)
}, 10 * 60 * 1000).unref()

// ----------------------------------------------------------- templates -------

app.get('/api/templates', requireAuth, (req, res) => {
  res.json({ templates: listTemplatesForUser(req.user.user_id) })
})

app.post('/api/templates', requireAuth, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : ''
  if (!name) {
    res.status(400).json({ error: 'Give this template a name.' })
    return
  }
  const count = db
    .prepare('SELECT COUNT(*) AS count FROM templates WHERE user_id = ?')
    .get(req.user.user_id).count
  if (count >= MAX_TEMPLATES) {
    res.status(400).json({ error: `You can keep up to ${MAX_TEMPLATES} templates.` })
    return
  }
  const id = randomUUID()
  const now = Date.now()
  const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 200) : ''
  const tags = cleanTemplateTags(req.body?.tags)
  const blocks = cleanTemplateBlocks(req.body?.blocks)
  db.prepare(
    `INSERT INTO templates (id, user_id, name, title, tags, blocks, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, req.user.user_id, name, title, JSON.stringify(tags), JSON.stringify(blocks), now, now)
  pushTemplates(req.user.user_id)
  res.status(201).json({ template: mapTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(id)) })
})

app.patch('/api/templates/:id', requireAuth, (req, res) => {
  const row = db
    .prepare('SELECT * FROM templates WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.user_id)
  if (!row) {
    res.status(404).json({ error: 'That template does not exist.' })
    return
  }
  const name =
    req.body?.name === undefined
      ? row.name
      : typeof req.body.name === 'string'
        ? req.body.name.trim().slice(0, 60)
        : ''
  if (!name) {
    res.status(400).json({ error: 'Give this template a name.' })
    return
  }
  const title =
    req.body?.title === undefined
      ? row.title
      : typeof req.body.title === 'string'
        ? req.body.title.trim().slice(0, 200)
        : ''
  const tags =
    req.body?.tags === undefined ? parseTags(row.tags) : cleanTemplateTags(req.body.tags)
  const blocks =
    req.body?.blocks === undefined
      ? parseTemplateBlocks(row.blocks)
      : cleanTemplateBlocks(req.body.blocks)
  db.prepare(
    `UPDATE templates SET name = ?, title = ?, tags = ?, blocks = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(
    name,
    title,
    JSON.stringify(tags),
    JSON.stringify(blocks),
    Date.now(),
    req.params.id,
    req.user.user_id,
  )
  pushTemplates(req.user.user_id)
  res.json({
    template: mapTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id)),
  })
})

app.delete('/api/templates/:id', requireAuth, (req, res) => {
  const result = db
    .prepare('DELETE FROM templates WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.user_id)
  if (Number(result.changes) === 0) {
    res.status(404).json({ error: 'That template does not exist.' })
    return
  }
  pushTemplates(req.user.user_id)
  res.json({ ok: true })
})

// --------------------------------------------------------------- admin -------

app.post(
  '/api/admin/users',
  requireAuth,
  requireAdmin,
  route(async (req, res) => {
    const displayName =
      typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : ''
    const pin = String(req.body?.pin ?? '')
    const requestedId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : ''
    if (!displayName) {
      res.status(400).json({ error: 'Enter a display name.' })
      return
    }
    if (!PIN_RE.test(pin)) {
      res.status(400).json({ error: 'Choose a 6-digit PIN.' })
      return
    }
    if (requestedId && !USER_ID_RE.test(requestedId)) {
      res.status(400).json({ error: 'The ID must be exactly 8 digits.' })
      return
    }
    if (requestedId && findUser(requestedId)) {
      res.status(409).json({ error: 'Another account already uses that ID.' })
      return
    }
    const userId = requestedId || generateUserId()
    try {
      db.prepare(
        `INSERT INTO users (user_id, pin_hash, display_name, is_admin, created_at)
         VALUES (?, ?, ?, 0, ?)`,
      ).run(userId, await hashPin(pin), displayName.slice(0, 40), Date.now())
    } catch (error) {
      if (String(error?.message || '').includes('UNIQUE')) {
        res.status(409).json({ error: 'Another account already uses that ID.' })
        return
      }
      throw error
    }
    logAdmin(req.user.user_id, userId, 'create', requestedId ? 'chosen ID' : 'generated ID')
    pushAdminSnapshot()
    res.status(201).json({
      user: publicUser(findUser(userId)),
      generatedId: !requestedId,
    })
  }),
)

function listAdminUsers() {
  const users = db
    .prepare(
      `SELECT u.user_id, u.display_name, u.is_admin, u.created_at, u.suspended_at,
              u.locked_until, u.failed_attempts,
              (SELECT COUNT(*) FROM notes n WHERE n.owner_id = u.user_id) AS note_count,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.user_id AND s.expires_at > ?)
                AS session_count,
              (SELECT MAX(s.last_seen) FROM sessions s WHERE s.user_id = u.user_id) AS last_seen
       FROM users u ORDER BY u.created_at ASC`,
    )
    .all(Date.now())
  return users.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
    suspendedAt: row.suspended_at ?? 0,
    lockedUntil: row.locked_until ?? 0,
    failedAttempts: row.failed_attempts ?? 0,
    noteCount: row.note_count,
    sessionCount: row.session_count,
    lastSeen: row.last_seen ?? null,
  }))
}

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ users: listAdminUsers() })
})

function adminStats() {
  const now = Date.now()
  const count = (sql, ...params) => Number(db.prepare(sql).get(...params).count)
  let dbBytes = 0
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      dbBytes += fs.statSync(`${databasePath}${suffix}`).size
    } catch {
      // The sidecar files only exist while the database is writing.
    }
  }
  return {
    accounts: count('SELECT COUNT(*) AS count FROM users'),
    admins: count('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1'),
    suspended: count('SELECT COUNT(*) AS count FROM users WHERE suspended_at > 0'),
    notes: count('SELECT COUNT(*) AS count FROM notes'),
    sessions: count('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?', now),
    dbBytes,
    version: APP_VERSION,
    node: process.version,
    uptime: Math.round(process.uptime()),
    signupsEnabled: signupsEnabled(),
    rooms: roomStats(),
    storage: {
      dataDir: storage.dataDir,
      source: storage.source,
      persistent: storage.onVolume,
      onRailway: storage.onRailway,
    },
  }
}

app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  res.json(adminStats())
})

function listAdminAudit(limit) {
  const rows = db
    .prepare(
      `SELECT a.id, a.actor_id, a.target_id, a.action, a.detail, a.created_at,
              actor.display_name AS actor_name, target.display_name AS target_name
       FROM admin_audit a
       LEFT JOIN users actor ON actor.user_id = a.actor_id
       LEFT JOIN users target ON target.user_id = a.target_id
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit)
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    targetId: row.target_id,
    targetName: row.target_name,
    action: row.action,
    detail: row.detail,
    createdAt: row.created_at,
  }))
}

app.get('/api/admin/audit', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40))
  res.json({ actions: listAdminAudit(limit) })
})

function adminSnapshot() {
  return { users: listAdminUsers(), stats: adminStats(), audit: listAdminAudit(40) }
}

// The event hub only owns sockets; these providers keep it free of route logic.
setNotesProvider((userId) => listNotesForUser(userId))
setTemplatesProvider((userId) => listTemplatesForUser(userId))
setAdminProvider(adminSnapshot)
onRoomActivity(() => scheduleAdminPush())

function purgeExpiredTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_MS
  const expired = db
    .prepare('SELECT id FROM notes WHERE trashed = 1 AND trashed_at > 0 AND trashed_at <= ?')
    .all(cutoff)
  if (expired.length === 0) return
  const audience = new Set()
  for (const row of expired) {
    for (const userId of noteAudience(row.id)) audience.add(userId)
    revokeNoteUnlocksForNote(row.id)
    disconnectNoteRoom(row.id, 4403)
    db.prepare('DELETE FROM notes WHERE id = ?').run(row.id)
  }
  pushNotes([...audience])
  scheduleAdminPush()
  console.log(
    `[trash] deleted ${expired.length} ${expired.length === 1 ? 'note' : 'notes'} trashed more than ${TRASH_RETENTION_DAYS} days ago`,
  )
}

app.post('/api/admin/signups', requireAuth, requireAdmin, (req, res) => {
  const enabled = req.body?.enabled === true
  setSetting('signups', enabled ? 'open' : 'closed')
  logAdmin(req.user.user_id, null, enabled ? 'signups_open' : 'signups_closed')
  pushAdminSnapshot()
  res.json({ enabled })
})

app.get('/api/admin/backup', requireAuth, requireAdmin, (req, res) => {
  const temp = path.join(
    os.tmpdir(),
    `quicky-backup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sqlite`,
  )
  try {
    // VACUUM INTO writes a consistent snapshot while the server keeps running.
    db.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`)
  } catch (error) {
    console.error('[backup]', error)
    res.status(500).json({ error: 'Could not create a backup.' })
    return
  }
  logAdmin(req.user.user_id, null, 'backup')
  pushAdminSnapshot()
  const filename = `quicky-notes-${new Date().toISOString().slice(0, 10)}.sqlite`
  res.download(temp, filename, (error) => {
    fs.rm(temp, { force: true }, () => {})
    if (error) console.error('[backup] could not send file', error.message)
  })
})

app.post('/api/admin/users/:userId/unlock', requireAuth, requireAdmin, (req, res) => {
  const user = findUser(req.params.userId)
  if (!user) {
    res.status(404).json({ error: 'No account has that ID.' })
    return
  }
  clearFailures(user.user_id)
  logAdmin(req.user.user_id, user.user_id, 'unlock')
  pushAdminSnapshot()
  res.json({ ok: true })
})

app.post('/api/admin/users/:userId/role', requireAuth, requireAdmin, (req, res) => {
  const user = findUser(req.params.userId)
  if (!user) {
    res.status(404).json({ error: 'No account has that ID.' })
    return
  }
  const wantAdmin = req.body?.isAdmin === true
  // A suspended admin cannot act, so only active admins keep this door open.
  if (!wantAdmin && user.is_admin === 1 && user.suspended_at === 0 && activeAdminCount() <= 1) {
    res.status(400).json({ error: 'Keep at least one active admin.' })
    return
  }
  if (user.is_admin !== (wantAdmin ? 1 : 0)) {
    db.prepare('UPDATE users SET is_admin = ? WHERE user_id = ?').run(
      wantAdmin ? 1 : 0,
      user.user_id,
    )
    logAdmin(req.user.user_id, user.user_id, wantAdmin ? 'role_admin' : 'role_member')
  }
  pushAdminSnapshot()
  res.json({ ok: true })
})

app.post('/api/admin/users/:userId/sessions', requireAuth, requireAdmin, (req, res) => {
  const user = findUser(req.params.userId)
  if (!user) {
    res.status(404).json({ error: 'No account has that ID.' })
    return
  }
  const isSelf = user.user_id === req.user.user_id
  const currentSession = hashToken(bearerToken(req))
  const result = isSelf
    ? db
        .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
        .run(user.user_id, currentSession)
    : db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.user_id)
  const revoked = Number(result.changes)
  if (isSelf) disconnectUser(user.user_id, 4401, currentSession)
  else disconnectUser(user.user_id, 4401)
  logAdmin(req.user.user_id, user.user_id, 'sessions', `${revoked} signed out`)
  pushAdminSnapshot()
  res.json({ revoked })
})

app.post('/api/admin/users/:userId/suspend', requireAuth, requireAdmin, (req, res) => {
  const user = findUser(req.params.userId)
  if (!user) {
    res.status(404).json({ error: 'No account has that ID.' })
    return
  }
  const suspend = req.body?.suspended === true
  if (suspend && user.user_id === req.user.user_id) {
    res.status(400).json({ error: 'You cannot suspend your own account.' })
    return
  }
  if (suspend && user.is_admin === 1 && activeAdminCount() <= 1) {
    res.status(400).json({ error: 'Keep at least one active admin.' })
    return
  }
  db.prepare('UPDATE users SET suspended_at = ? WHERE user_id = ?').run(
    suspend ? Date.now() : 0,
    user.user_id,
  )
  if (suspend) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.user_id)
    disconnectUser(user.user_id, 4401)
  }
  logAdmin(req.user.user_id, user.user_id, suspend ? 'suspend' : 'restore')
  pushAdminSnapshot()
  res.json({ ok: true })
})

app.delete('/api/admin/users/:userId', requireAuth, requireAdmin, (req, res) => {
  const user = findUser(req.params.userId)
  if (!user) {
    res.status(404).json({ error: 'No account has that ID.' })
    return
  }
  if (user.user_id === req.user.user_id) {
    res.status(400).json({ error: 'You cannot delete your own account.' })
    return
  }
  if (user.is_admin === 1 && adminCount() <= 1) {
    res.status(400).json({ error: 'Keep at least one admin.' })
    return
  }
  const owned = Number(
    db.prepare('SELECT COUNT(*) AS count FROM notes WHERE owner_id = ?').get(user.user_id).count,
  )
  const affected = new Set([req.user.user_id])
  const touchedNotes = [
    ...db.prepare('SELECT id FROM notes WHERE owner_id = ?').all(user.user_id),
    ...db.prepare('SELECT note_id FROM note_members WHERE user_id = ?').all(user.user_id),
  ]
  for (const row of touchedNotes) {
    for (const id of noteAudience(row.id ?? row.note_id)) affected.add(id)
  }
  db.exec('BEGIN')
  try {
    // Notes outlive the account: they move to the admin doing the deleting so
    // nobody else loses access to a shared note.
    db.prepare('UPDATE notes SET owner_id = ? WHERE owner_id = ?').run(
      req.user.user_id,
      user.user_id,
    )
    db.prepare('DELETE FROM users WHERE user_id = ?').run(user.user_id)
    logAdmin(req.user.user_id, user.user_id, 'delete', `${owned} notes transferred`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  pushNotes([...affected])
  pushAdminSnapshot()
  disconnectUser(user.user_id, 4401)
  res.json({ ok: true, notesTransferred: owned })
})

app.post(
  '/api/admin/users/:userId/pin',
  requireAuth,
  requireAdmin,
  route(async (req, res) => {
    const newPin = String(req.body?.pin ?? '')
    if (!PIN_RE.test(newPin)) {
      res.status(400).json({ error: 'The new PIN must be 6 digits.' })
      return
    }
    const user = findUser(req.params.userId)
    if (!user) {
      res.status(404).json({ error: 'No account has that ID.' })
      return
    }
    db.prepare('UPDATE users SET pin_hash = ?, failed_attempts = 0, locked_until = 0 WHERE user_id = ?').run(
      await hashPin(newPin),
      user.user_id,
    )
    // Any device still holding a session for that account must sign in again.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.user_id)
    disconnectUser(user.user_id, 4401)
    logAdmin(req.user.user_id, user.user_id, 'pin')
    pushAdminSnapshot()
    res.json({ ok: true })
  }),
)

app.post('/api/admin/users/:userId/id', requireAuth, requireAdmin, (req, res) => {
  const currentId = req.params.userId
  const newId = String(req.body?.userId ?? '').trim()
  if (!USER_ID_RE.test(newId)) {
    res.status(400).json({ error: 'The new ID must be exactly 8 digits.' })
    return
  }
  if (!findUser(currentId)) {
    res.status(404).json({ error: 'No account has that ID.' })
    return
  }
  if (findUser(newId)) {
    res.status(409).json({ error: 'Another account already uses that ID.' })
    return
  }
  // Foreign keys cascade the change through sessions, notes and memberships.
  db.prepare('UPDATE users SET user_id = ? WHERE user_id = ?').run(newId, currentId)
  logAdmin(req.user.user_id, newId, 'id', `${currentId} → ${newId}`)
  pushNotesForUser(newId)
  pushAdminSnapshot()
  if (currentId !== req.user.user_id) disconnectUser(currentId, 4002)
  res.json({ user: publicUser(findUser(newId)) })
})

// --------------------------------------------------------------- static ------

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    users: countUsers(),
    uptime: Math.round(process.uptime()),
    storage: storage.onVolume ? 'volume' : 'ephemeral',
  })
})

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Unknown API route.' })
})

const indexFile = path.join(DIST_DIR, 'index.html')
if (fs.existsSync(indexFile)) {
  // The manifest and worker must never be frozen by the one-year static cache.
  const manifestFile = path.join(DIST_DIR, 'manifest.webmanifest')
  const serviceWorkerFile = path.join(DIST_DIR, 'sw.js')
  if (fs.existsSync(manifestFile)) {
    app.get('/manifest.webmanifest', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.type('application/manifest+json').sendFile(manifestFile)
    })
  }
  if (fs.existsSync(serviceWorkerFile)) {
    app.get('/sw.js', (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Service-Worker-Allowed', '/')
      res.type('application/javascript').sendFile(serviceWorkerFile)
    })
  }

  // iOS caches the auto-discovered root icons aggressively. Serve the legacy
  // paths with no-cache and point new HTML at a versioned file instead.
  const touchIconFile = path.join(DIST_DIR, 'apple-touch-icon.png')
  const touchIconV3File = path.join(DIST_DIR, 'apple-touch-icon-v3.png')
  if (fs.existsSync(touchIconFile) && fs.existsSync(touchIconV3File)) {
    app.get(
      ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/apple-touch-icon-v3.png'],
      (req, res) => {
        const file = req.path === '/apple-touch-icon-v3.png' ? touchIconV3File : touchIconFile
        res.setHeader('Cache-Control', 'no-cache')
        res.type('image/png').sendFile(file)
      },
    )
  }

  // Read once: the single-page shell is served for every non-API route.
  const indexHtml = fs.readFileSync(indexFile, 'utf8')
  app.use(express.static(DIST_DIR, { index: false, maxAge: '1y' }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    res.setHeader('Cache-Control', 'no-store')
    res.type('html').send(indexHtml)
  })
} else {
  app.get('/', (req, res) => {
    res
      .type('text/plain')
      .send('Quicky Notes API is running.\n\nRun `npm run dev` for the client, or `npm run build` to create dist/.')
  })
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'That request body was not valid JSON.' })
    return
  }
  console.error('[api]', err)
  res.status(500).json({ error: 'Something went wrong on the server.' })
})

// ------------------------------------------------------------ websockets -----

const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })

function disconnectUser(userId, code = 4401, exceptSessionHash = null) {
  for (const client of wss.clients) {
    if (client.user?.userId !== userId) continue
    if (exceptSessionHash && client.sessionHash === exceptSessionHash) continue
    client.close(code, code === 4002 ? 'Reconnect' : 'Access changed')
  }
}

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

function canAccessNote(noteId, userId) {
  return !!db
    .prepare(
      `SELECT 1 FROM notes n
       WHERE n.id = ? AND (n.owner_id = ? OR EXISTS (
         SELECT 1 FROM note_members m WHERE m.note_id = n.id AND m.user_id = ?
       ))`,
    )
    .get(noteId, userId, userId)
}

// Re-check live sockets on every message. This is the server-side guard for
// membership removal, note locks, and sessions that were revoked after the
// connection was established.
setConnectionAuthorizer((conn) => {
  if (conn.publicShare) {
    const row = db
      .prepare('SELECT id, trashed FROM notes WHERE public_token = ?')
      .get(conn.publicShare)
    if (!row || row.trashed === 1 || row.id !== conn.noteId) {
      return { read: false, write: false, code: 4403 }
    }
    return { read: true, write: false }
  }
  if (!conn.sessionHash || !sessionIsActive(conn.sessionHash)) {
    return { read: false, write: false, code: 4401 }
  }
  if (!conn.noteId) return { read: true, write: true }
  const access = accessFor(conn.noteId, conn.user?.userId)
  if (!access?.role) return { read: false, write: false, code: 4403 }
  const note = db.prepare('SELECT trashed FROM notes WHERE id = ?').get(conn.noteId)
  if (!note) return { read: false, write: false, code: 4403 }
  if (note.trashed === 1 && access.role !== 'owner') {
    return { read: true, write: false }
  }
  return {
    read: true,
    write: access.permissions.edit && canWriteNote(conn.noteId, conn.sessionHash),
  }
})

// Only the owner may trash or restore a note. Editors still can edit an active
// note, but a write that would change its trash state is rejected before it is
// merged into the live room and saved.
setUpdateAuthorizer((conn, doc, update) => {
  if (conn.publicShare) return false
  const access = accessFor(conn.noteId, conn.user?.userId)
  if (!access?.permissions.edit) return false
  if (access.role === 'owner') return true
  const before = doc.getMap('meta').get('trashed') === true
  const probe = new Y.Doc()
  try {
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc))
    Y.applyUpdate(probe, update)
    return (probe.getMap('meta').get('trashed') === true) === before
  } catch {
    return false
  } finally {
    probe.destroy()
  }
})

server.on('upgrade', (req, socket, head) => {
  let url
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  } catch {
    rejectUpgrade(socket, 400, 'Bad Request')
    return
  }
  if (!url.pathname.startsWith('/ws/')) {
    rejectUpgrade(socket, 404, 'Not Found')
    return
  }
  const room = decodeURIComponent(url.pathname.slice('/ws/'.length))
  const share = url.searchParams.get('share')
  if (share) {
    if (!room.startsWith('note:')) {
      rejectUpgrade(socket, 404, 'Not Found')
      return
    }
    const published = db
      .prepare('SELECT id, trashed FROM notes WHERE public_token = ?')
      .get(share)
    if (!published || published.trashed === 1 || room !== `note:${published.id}`) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.publicShare = share
      ws.noteId = published.id
      ws.user = null
      attachConnection(ws, room)
    })
    return
  }
  const token = url.searchParams.get('token')
  const user = userForToken(token)
  if (!user) {
    rejectUpgrade(socket, 401, 'Unauthorized')
    return
  }
  const isNote = room.startsWith('note:')
  if (!isNote && room !== 'lobby' && room !== 'events') {
    rejectUpgrade(socket, 404, 'Not Found')
    return
  }
  if (isNote && !canAccessNote(room.slice(5), user.user_id)) {
    rejectUpgrade(socket, 403, 'Forbidden')
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.user = publicUser(user)
    ws.sessionHash = hashToken(token || '')
    ws.noteId = isNote ? room.slice(5) : null
    if (room === 'events') {
      attachEvents(ws)
      sendEvent(ws, { type: 'notes:snapshot', notes: listNotesForUser(user.user_id) })
      sendTemplatesSnapshot(ws)
      if (user.is_admin === 1) sendAdminSnapshot(ws)
      return
    }
    attachConnection(ws, room)
  })
})

// --------------------------------------------------------------- startup -----

purgeExpiredSessions()
purgeExpiredTrash()
setInterval(() => purgeExpiredSessions(), 60 * 60 * 1000).unref()
setInterval(purgeExpiredTrash, TRASH_SWEEP_MS).unref()

server.listen(PORT, HOST, () => {
  console.log(`[quicky] listening on ${HOST}:${PORT}`)
  console.log(`[quicky] data directory: ${storage.dataDir} (${storage.source})`)
  console.log(`[quicky] database: ${storage.databasePath}`)
  console.log(
    `[quicky] persistence: ${
      storage.onVolume
        ? `Railway volume at ${storage.volumeMountPath}`
        : 'container filesystem (not persistent across deploys)'
    }`,
  )
  if (storage.onRailway && !storage.onVolume) {
    console.warn(
      '[quicky] WARNING: no Railway volume detected. Accounts and notes will be lost on the next deploy. Attach a volume to this service and restart.',
    )
  }
  console.log(`[quicky] signups: ${signupsEnabled() ? 'open' : 'closed'}`)
})

function shutdown(signal) {
  console.log(`[quicky] ${signal} received, shutting down`)
  for (const client of wss.clients) client.close(1001, 'Server restarting')
  server.close(() => {
    closeAllRooms()
    db.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 8000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
