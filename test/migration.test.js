import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('upgrades a database created before parent and public links', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quicky-migration-'))
  const databasePath = path.join(dataDir, 'quicky-notes.sqlite')

  try {
    const oldDb = new DatabaseSync(databasePath)
    oldDb.exec(`
      CREATE TABLE notes (
        id         TEXT PRIMARY KEY,
        owner_id   TEXT NOT NULL,
        title      TEXT NOT NULL DEFAULT '',
        due        TEXT,
        starred    INTEGER NOT NULL DEFAULT 0,
        trashed    INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        content    BLOB,
        text       TEXT NOT NULL DEFAULT '',
        tags       TEXT NOT NULL DEFAULT '[]'
      ) STRICT;
    `)
    oldDb.close()

    const migration = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', "await import('./server/db.js')"],
      {
        cwd: root,
        env: { ...process.env, DATA_DIR: dataDir, DATABASE_PATH: databasePath },
        encoding: 'utf8',
      },
    )
    assert.equal(
      migration.status,
      0,
      `database migration failed:\n${migration.stderr || migration.stdout}`,
    )

    const migrated = new DatabaseSync(databasePath)
    const columns = migrated
      .prepare('PRAGMA table_info(notes)')
      .all()
      .map((column) => column.name)
    assert.ok(columns.includes('parent_id'))
    assert.ok(columns.includes('public_token'))

    const indexes = migrated.prepare('PRAGMA index_list(notes)').all()
    assert.ok(
      indexes.some((index) => index.name === 'notes_public_token' && index.unique === 1),
      'public-token index was not created',
    )
    migrated.close()
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})
