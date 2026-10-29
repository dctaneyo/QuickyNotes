import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

const cwd = process.cwd()

function resolveFromCwd(value) {
  return path.isAbsolute(value) ? value : path.resolve(cwd, value)
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

// Railway injects the actual volume path. Use it automatically so a missing or
// stale DATA_DIR cannot silently put SQLite back on the disposable container
// filesystem. DATA_DIR is still honoured when it points inside the volume.
const explicitDatabasePath = process.env.DATABASE_PATH?.trim()
const configuredDataDir = process.env.DATA_DIR?.trim()
const volumeMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim()

let dataDir
let source
if (explicitDatabasePath) {
  dataDir = path.dirname(resolveFromCwd(explicitDatabasePath))
  source = 'DATABASE_PATH'
} else if (volumeMountPath) {
  const volumePath = resolveFromCwd(volumeMountPath)
  if (configuredDataDir && isInside(volumePath, resolveFromCwd(configuredDataDir))) {
    dataDir = resolveFromCwd(configuredDataDir)
    source = 'DATA_DIR inside the Railway volume'
  } else {
    dataDir = volumePath
    source = 'RAILWAY_VOLUME_MOUNT_PATH'
  }
} else if (configuredDataDir) {
  dataDir = resolveFromCwd(configuredDataDir)
  source = 'DATA_DIR'
} else {
  dataDir = path.join(cwd, 'data')
  source = 'local default'
}

try {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.accessSync(dataDir, fs.constants.W_OK)
} catch (error) {
  console.error(`[quicky] cannot write to data directory ${dataDir}: ${error.message}`)
  throw error
}

export const databasePath = explicitDatabasePath
  ? resolveFromCwd(explicitDatabasePath)
  : path.join(dataDir, 'quicky-notes.sqlite')

export const storage = {
  dataDir,
  databasePath,
  source,
  volumeMountPath: volumeMountPath ? resolveFromCwd(volumeMountPath) : null,
  onRailway: Boolean(
    volumeMountPath ||
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_PROJECT_ID,
  ),
  onVolume: Boolean(volumeMountPath && isInside(resolveFromCwd(volumeMountPath), databasePath)),
}

export const db = new DatabaseSync(databasePath)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id         TEXT PRIMARY KEY,
    pin_hash        TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    is_admin        INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS notes (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '',
    due        TEXT,
    starred    INTEGER NOT NULL DEFAULT 0,
    trashed    INTEGER NOT NULL DEFAULT 0,
    trashed_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    content    BLOB,
    text       TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '[]'
  ) STRICT;
  CREATE INDEX IF NOT EXISTS notes_owner ON notes(owner_id);
  CREATE INDEX IF NOT EXISTS notes_updated ON notes(updated_at DESC);

  CREATE TABLE IF NOT EXISTS note_members (
    note_id    TEXT NOT NULL REFERENCES notes(id) ON UPDATE CASCADE ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'editor',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (note_id, user_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS note_members_user ON note_members(user_id);

  CREATE TABLE IF NOT EXISTS note_locks (
    note_id       TEXT PRIMARY KEY REFERENCES notes(id) ON UPDATE CASCADE ON DELETE CASCADE,
    password_hash TEXT,
    locked_at     INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS note_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id    TEXT NOT NULL REFERENCES notes(id) ON UPDATE CASCADE ON DELETE CASCADE,
    actor_id   TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    changes    TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS note_history_note ON note_history(note_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS admin_audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id   TEXT NOT NULL,
    target_id  TEXT,
    action     TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit(created_at DESC);

  CREATE TABLE IF NOT EXISTS templates (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    name       TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '[]',
    blocks     TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS templates_user ON templates(user_id, updated_at DESC);
`)

// Lightweight migration for user rows created before suspension existed.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name)
if (!userColumns.includes('suspended_at')) {
  db.exec('ALTER TABLE users ADD COLUMN suspended_at INTEGER NOT NULL DEFAULT 0')
}

// Lightweight migration for databases created before full-text mirroring.
const noteColumns = db.prepare('PRAGMA table_info(notes)').all().map((column) => column.name)
if (!noteColumns.includes('text')) {
  db.exec("ALTER TABLE notes ADD COLUMN text TEXT NOT NULL DEFAULT ''")
}
if (!noteColumns.includes('tags')) {
  db.exec("ALTER TABLE notes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
}
if (!noteColumns.includes('trashed_at')) {
  db.exec('ALTER TABLE notes ADD COLUMN trashed_at INTEGER NOT NULL DEFAULT 0')
}
// Notes trashed before this column existed start their countdown from their
// last edit, which is the closest honest estimate available.
db.exec('UPDATE notes SET trashed_at = updated_at WHERE trashed = 1 AND trashed_at = 0')

export function countUsers() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row?.value ?? null
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

export function purgeExpiredSessions(now = Date.now()) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
}
