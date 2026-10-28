import express from 'express'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { db, countUsers, purgeExpiredSessions } from './db.js'
import {
  PIN_RE,
  USER_ID_RE,
  bearerToken,
  clearFailures,
  createSession,
  displayNameFor,
  findUser,
  generateUserId,
  hashPin,
  hashToken,
  publicUser,
  registerFailure,
  requireAdmin,
  requireAuth,
  throttleIp,
  userForToken,
  verifyPin,
} from './auth.js'
import { attachConnection, closeAllRooms } from './realtime.js'

const app = express()
const server = http.createServer(app)
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false'
const DIST_DIR = path.join(process.cwd(), 'dist')

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

app.post(
  '/api/auth/signup',
  route(async (req, res) => {
    if (!ALLOW_SIGNUP) {
      res.status(403).json({ error: 'New accounts are closed on this server.' })
      return
    }
    const pin = String(req.body?.pin ?? '')
    if (!PIN_RE.test(pin)) {
      res.status(400).json({ error: 'Choose a 6-digit PIN.' })
      return
    }
    const requestedName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : ''
    const userId = generateUserId()
    const isAdmin = countUsers() === 0
    db.prepare(
      `INSERT INTO users (user_id, pin_hash, display_name, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      userId,
      await hashPin(pin),
      requestedName.slice(0, 40) || displayNameFor(userId),
      isAdmin ? 1 : 0,
      Date.now(),
    )
    const session = createSession(userId)
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
    res.json({ token: session.token, user: publicUser(row) })
  }),
)

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(bearerToken(req)))
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
    // Other devices signed in with the old PIN are signed out.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(
      req.user.user_id,
      hashToken(bearerToken(req)),
    )
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
  res.json({ user: publicUser(findUser(req.user.user_id)) })
})

// --------------------------------------------------------------- notes -------

function accessFor(noteId, userId) {
  const row = db
    .prepare(
      `SELECT n.owner_id,
              CASE WHEN n.owner_id = ? THEN 'owner'
                   ELSE (SELECT role FROM note_members m WHERE m.note_id = n.id AND m.user_id = ?)
              END AS role
       FROM notes n WHERE n.id = ?`,
    )
    .get(userId, userId, noteId)
  if (!row) return null
  return { ownerId: row.owner_id, role: row.role ?? null }
}

function parseTags(raw) {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === 'string') : []
  } catch {
    return []
  }
}

function mapNote(row) {
  return {
    id: row.id,
    title: row.title,
    due: row.due,
    tags: parseTags(row.tags),
    starred: row.starred === 1,
    trashed: row.trashed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    role: row.role,
    memberCount: row.member_count ?? 1,
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
      `SELECT m.user_id, m.role, u.display_name
       FROM note_members m JOIN users u ON u.user_id = m.user_id
       WHERE m.note_id = ? ORDER BY u.display_name COLLATE NOCASE`,
    )
    .all(noteId)
  return [
    { userId: note.owner_id, displayName: note.display_name, role: 'owner' },
    ...rest.map((row) => ({ userId: row.user_id, displayName: row.display_name, role: row.role })),
  ]
}

app.get('/api/notes', requireAuth, (req, res) => {
  const userId = req.user.user_id
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const params = [userId, userId, userId]
  let sql = `
    SELECT n.*, u.display_name AS owner_name,
           CASE WHEN n.owner_id = ? THEN 'owner' ELSE m.role END AS role,
           1 + (SELECT COUNT(*) FROM note_members mc WHERE mc.note_id = n.id) AS member_count
    FROM notes n
    JOIN users u ON u.user_id = n.owner_id
    LEFT JOIN note_members m ON m.note_id = n.id AND m.user_id = ?
    WHERE (n.owner_id = ? OR m.user_id IS NOT NULL)`
  if (query) {
    sql += ' AND (n.title LIKE ? OR n.text LIKE ?)'
    params.push(`%${query}%`, `%${query}%`)
  }
  sql += ' ORDER BY n.updated_at DESC'
  res.json({ notes: db.prepare(sql).all(...params).map(mapNote) })
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
  db.prepare(
    `INSERT INTO notes (id, owner_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.user.user_id,
    String(req.body?.title ?? '').slice(0, 200),
    Date.now(),
    Date.now(),
  )
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
      `SELECT n.*, u.display_name AS owner_name FROM notes n
       JOIN users u ON u.user_id = n.owner_id WHERE n.id = ?`,
    )
    .get(req.params.id)
  res.json({
    note: mapNote({ ...row, role: access.role, member_count: membersOf(row.id).length }),
    members: membersOf(row.id),
  })
})

app.delete('/api/notes/:id', requireAuth, (req, res) => {
  const access = accessFor(req.params.id, req.user.user_id)
  if (!access || access.role !== 'owner') {
    res.status(403).json({ error: 'Only the owner can delete this note.' })
    return
  }
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id)
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
  db.prepare(
    `INSERT INTO note_members (note_id, user_id, role, created_at) VALUES (?, ?, 'editor', ?)
     ON CONFLICT(note_id, user_id) DO NOTHING`,
  ).run(req.params.id, targetId, Date.now())
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
  db.prepare('DELETE FROM note_members WHERE note_id = ? AND user_id = ?').run(
    req.params.id,
    targetId,
  )
  res.json({ members: membersOf(req.params.id) })
})

// --------------------------------------------------------------- admin -------

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db
    .prepare(
      `SELECT u.user_id, u.display_name, u.is_admin, u.created_at,
              (SELECT COUNT(*) FROM notes n WHERE n.owner_id = u.user_id) AS note_count
       FROM users u ORDER BY u.created_at ASC`,
    )
    .all()
  res.json({
    users: users.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      isAdmin: row.is_admin === 1,
      createdAt: row.created_at,
      noteCount: row.note_count,
    })),
  })
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
  res.json({ user: publicUser(findUser(newId)) })
})

// --------------------------------------------------------------- static ------

app.get('/healthz', (req, res) => {
  res.json({ ok: true, users: countUsers(), uptime: Math.round(process.uptime()) })
})

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Unknown API route.' })
})

const indexFile = path.join(DIST_DIR, 'index.html')
if (fs.existsSync(indexFile)) {
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
  const user = userForToken(url.searchParams.get('token'))
  if (!user) {
    rejectUpgrade(socket, 401, 'Unauthorized')
    return
  }
  const room = decodeURIComponent(url.pathname.slice('/ws/'.length))
  const isNote = room.startsWith('note:')
  if (!isNote && room !== 'lobby') {
    rejectUpgrade(socket, 404, 'Not Found')
    return
  }
  if (isNote && !canAccessNote(room.slice(5), user.user_id)) {
    rejectUpgrade(socket, 403, 'Forbidden')
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.user = publicUser(user)
    attachConnection(ws, room)
  })
})

// --------------------------------------------------------------- startup -----

purgeExpiredSessions()
setInterval(() => purgeExpiredSessions(), 60 * 60 * 1000).unref()

server.listen(PORT, HOST, () => {
  console.log(`[quicky] listening on ${HOST}:${PORT}`)
  console.log(`[quicky] data directory: ${process.env.DATA_DIR || './data'}`)
  console.log(`[quicky] signups: ${ALLOW_SIGNUP ? 'open' : 'closed (ALLOW_SIGNUP=false)'}`)
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
