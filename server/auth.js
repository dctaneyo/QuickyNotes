import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { db } from './db.js'

const scrypt = promisify(crypto.scrypt)

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_FAILURES = 5
const LOCKOUT_MS = 5 * 60 * 1000

export const USER_ID_RE = /^\d{8}$/
export const PIN_RE = /^\d{6}$/

export async function hashPin(pin) {
  const salt = crypto.randomBytes(16)
  const derived = await scrypt(pin, salt, SCRYPT.keylen, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPin(pin, stored) {
  try {
    const [scheme, n, r, p, saltHex, hashHex] = String(stored).split('$')
    if (scheme !== 'scrypt') return false
    const salt = Buffer.from(saltHex, 'hex')
    const expected = Buffer.from(hashHex, 'hex')
    const derived = await scrypt(pin, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    })
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(token), userId, now, now + SESSION_TTL_MS, now)
  return { token, expiresAt: now + SESSION_TTL_MS }
}

/** Eight digits, never starting with 0 so it reads as a real ID. */
export function generateUserId() {
  const exists = db.prepare('SELECT 1 FROM users WHERE user_id = ?')
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const id = String(crypto.randomInt(10_000_000, 100_000_000))
    if (!exists.get(id)) return id
  }
  throw new Error('Could not allocate a user id')
}

export function displayNameFor(userId) {
  return `Member ${userId.slice(-3)}`
}

export function publicUser(row) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    isAdmin: row.is_admin === 1,
  }
}

export function findUser(userId) {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId)
}

export function bearerToken(req) {
  const header = req.get('authorization') || ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  return token.length >= 20 ? token : null
}

export function userForToken(token) {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT u.*, s.token_hash FROM sessions s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), Date.now())
  if (!row) return null
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(Date.now(), row.token_hash)
  return row
}

export function requireAuth(req, res, next) {
  const user = userForToken(bearerToken(req))
  if (!user) {
    res.status(401).json({ error: 'Sign in to continue.' })
    return
  }
  req.user = user
  next()
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    res.status(403).json({ error: 'Only an admin can do that.' })
    return
  }
  next()
}

/** Failed-login bookkeeping lives on the user row so it survives restarts. */
export function registerFailure(row) {
  const failures = (row.failed_attempts ?? 0) + 1
  if (failures >= MAX_FAILURES) {
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE user_id = ?').run(
      Date.now() + LOCKOUT_MS,
      row.user_id,
    )
    return { lockedForMs: LOCKOUT_MS, remaining: 0 }
  }
  db.prepare('UPDATE users SET failed_attempts = ? WHERE user_id = ?').run(failures, row.user_id)
  return { lockedForMs: 0, remaining: MAX_FAILURES - failures }
}

export function clearFailures(userId) {
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE user_id = ?').run(userId)
}

// Cheap per-IP throttle in front of the per-account lockout.
const ipWindow = new Map()
const IP_WINDOW_MS = 10 * 60 * 1000
const IP_MAX = 40

export function throttleIp(ip) {
  const now = Date.now()
  const entry = ipWindow.get(ip)
  if (!entry || entry.resetAt < now) {
    ipWindow.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS })
    return { blocked: false, retryAfter: 0 }
  }
  entry.count += 1
  if (entry.count > IP_MAX) {
    return { blocked: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }
  return { blocked: false, retryAfter: 0 }
}

setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of ipWindow) if (entry.resetAt < now) ipWindow.delete(ip)
}, 5 * 60 * 1000).unref()
