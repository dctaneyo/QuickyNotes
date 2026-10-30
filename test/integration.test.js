import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import WebSocket from 'ws'
import * as Y from 'yjs'

const MESSAGE_SAVED = 4
const MESSAGE_LOADED = 6

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

async function waitForHealth(base, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`)
    try {
      const response = await fetch(`${base}/healthz`)
      if (response.ok) return
    } catch {
      // still booting
    }
    await sleep(100)
  }
  throw new Error('server did not become healthy')
}

async function request(base, pathName, token, options = {}) {
  const response = await fetch(`${base}${pathName}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${response.status}: ${data.error ?? response.statusText}`)
  return data
}

async function signUp(base, displayName) {
  const pin = '246810'
  return request(base, '/api/auth/signup', null, {
    method: 'POST',
    body: { displayName, pin },
  })
}

function makeUpdate(title, text, options = {}) {
  const doc = new Y.Doc()
  doc.transact(() => {
    const meta = doc.getMap('meta')
    meta.set('title', title)
    meta.set('tags', [])
    meta.set('due', new Date().toISOString().slice(0, 10))
    meta.set('starred', false)
    meta.set('trashed', options.trashed === true)
    meta.set('ownerId', 'test-owner')
    meta.set('createdAt', Date.now())
    meta.set('updatedAt', Date.now())
    const blocks = doc.getArray('blocks')
    const block = new Y.Map()
    blocks.push([block])
    block.set('id', randomUUID())
    block.set('type', 'text')
    block.set('indent', 0)
    block.set('checked', false)
    const value = new Y.Text()
    value.insert(0, text)
    block.set('text', value)
  })
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

function connectRaw(url) {
  const ws = new WebSocket(url)
  const received = []
  const waiters = []
  let closeInfo = null
  const closeWaiters = []
  const waitFor = (match) => {
    const found = received.find(match)
    if (found) return Promise.resolve(found)
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve, reject, timer: null }
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index !== -1) waiters.splice(index, 1)
        reject(new Error('timed out waiting for a socket message'))
      }, 5000)
      waiters.push(waiter)
    })
  }
  ws.on('message', (raw) => {
    const bytes = new Uint8Array(raw)
    const decoder = decoding.createDecoder(bytes)
    const type = decoding.readVarUint(decoder)
    const message = { type, decoder, raw: bytes }
    received.push(message)
    for (const waiter of [...waiters]) {
      if (!waiter.match(message)) continue
      waiters.splice(waiters.indexOf(waiter), 1)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    }
  })
  ws.on('close', (code, reason) => {
    closeInfo = { code, reason: String(reason) }
    for (const waiter of [...closeWaiters]) {
      closeWaiters.splice(closeWaiters.indexOf(waiter), 1)
      clearTimeout(waiter.timer)
      waiter.resolve(closeInfo)
    }
  })
  const opened = new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  return {
    ws,
    opened,
    waitForType(type) {
      return waitFor((message) => message.type === type)
    },
    waitForSyncStep2() {
      return waitFor((message) => {
        if (message.type !== 0) return false
        const decoder = decoding.createDecoder(message.raw)
        decoding.readVarUint(decoder)
        return decoding.readVarUint(decoder) === syncProtocol.messageYjsSyncStep2
      })
    },
    waitForClose() {
      if (closeInfo) return Promise.resolve(closeInfo)
      return new Promise((resolve, reject) => {
        const waiter = { resolve, timer: null }
        waiter.timer = setTimeout(() => {
          const index = closeWaiters.indexOf(waiter)
          if (index !== -1) closeWaiters.splice(index, 1)
          reject(new Error('timed out waiting for a socket close'))
        }, 5000)
        closeWaiters.push(waiter)
      })
    },
  }
}

function sendUpdate(ws, update) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.writeUpdate(encoder, update)
  ws.send(encoding.toUint8Array(encoder))
}

async function readCurrentDoc(socket) {
  const doc = new Y.Doc()
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.writeSyncStep1(encoder, doc)
  socket.ws.send(encoding.toUint8Array(encoder))
  const message = await socket.waitForSyncStep2()
  const decoder = decoding.createDecoder(message.raw)
  decoding.readVarUint(decoder)
  decoding.readVarUint(decoder)
  Y.applyUpdate(doc, decoding.readVarUint8Array(decoder))
  return doc
}

test('live note permissions, save acknowledgements, and revocation', async (t) => {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quicky-test-'))
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ALLOW_SIGNUP: 'true',
      TRASH_SWEEP_MS: '60000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverOutput = ''
  child.stdout.on('data', (chunk) => {
    serverOutput += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    serverOutput += String(chunk)
  })

  const sockets = []
  t.after(async () => {
    for (const socket of sockets) {
      try {
        socket.close()
      } catch {
        // already closed
      }
    }
    child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(3000),
    ])
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  try {
    await waitForHealth(base, child)
    const owner = await signUp(base, 'Owner')
    const editor = await signUp(base, 'Editor')
    const viewer = await signUp(base, 'Viewer')
    // The lobby is presence-only, but y-websocket still completes the Yjs
    // handshake. It must stay connected or the header badge loops between
    // "Reconnecting" and "Synced" whenever no note is open.
    const lobbySocket = connectRaw(
      `ws://127.0.0.1:${port}/ws/lobby?token=${encodeURIComponent(owner.token)}`,
    )
    sockets.push(lobbySocket.ws)
    await lobbySocket.opened
    await lobbySocket.waitForType(MESSAGE_LOADED)
    const lobbyDoc = new Y.Doc()
    const lobbyHandshake = encoding.createEncoder()
    encoding.writeVarUint(lobbyHandshake, 0)
    syncProtocol.writeSyncStep2(lobbyHandshake, lobbyDoc)
    lobbySocket.ws.send(encoding.toUint8Array(lobbyHandshake))
    await sleep(300)
    assert.equal(lobbySocket.ws.readyState, WebSocket.OPEN)
    lobbyDoc.destroy()

    const noteId = randomUUID()
    await request(base, '/api/notes', owner.token, {
      method: 'POST',
      body: { id: noteId, title: 'Live test' },
    })
    const childId = randomUUID()
    await request(base, '/api/notes', owner.token, {
      method: 'POST',
      body: { id: childId, title: 'Child page', parentId: noteId },
    })
    const nested = await request(base, '/api/notes', owner.token)
    assert.equal(nested.notes.find((note) => note.id === childId)?.parentId, noteId)

    const ownerSocket = connectRaw(
      `ws://127.0.0.1:${port}/ws/note:${noteId}?token=${encodeURIComponent(owner.token)}`,
    )
    sockets.push(ownerSocket.ws)
    await ownerSocket.opened
    await ownerSocket.waitForType(MESSAGE_LOADED)

    const firstUpdate = makeUpdate('First saved title', 'one')
    sendUpdate(ownerSocket.ws, firstUpdate)
    const ack = await ownerSocket.waitForType(MESSAGE_SAVED)
    assert.equal(ack.type, MESSAGE_SAVED)

    // A duplicate update is acknowledged only when the server already has
    // durable state, without waiting for another debounce cycle.
    sendUpdate(ownerSocket.ws, firstUpdate)
    await ownerSocket.waitForType(MESSAGE_SAVED)
    assert.equal(ack.type, MESSAGE_SAVED)

    await sleep(1700)
    const secondUpdate = makeUpdate('Second saved title', 'two')
    sendUpdate(ownerSocket.ws, secondUpdate)
    await ownerSocket.waitForType(MESSAGE_SAVED)
    await sleep(1700)
    const history = await request(base, `/api/notes/${noteId}/history`, owner.token)
    assert.ok(history.entries.length >= 2)
    // Entries are newest first, so this restores the version before the
    // second edit and proves the snapshot is not just the live document.
    const restored = await request(
      base,
      `/api/notes/${noteId}/history/${history.entries[1].id}/restore`,
      owner.token,
      { method: 'POST', body: {} },
    )
    assert.equal(restored.ok, true)
    await sleep(800)
    const restoredNote = await request(base, `/api/notes/${noteId}`, owner.token)
    assert.equal(restoredNote.note.title, 'First saved title')

    const exported = await request(base, '/api/notes/export', owner.token)
    assert.equal(exported.version, 1)
    assert.ok(exported.notes.some((note) => note.id === noteId))

    await request(base, `/api/notes/${noteId}/members`, owner.token, {
      method: 'POST',
      body: { userId: editor.user.userId, role: 'editor' },
    })
    await request(base, `/api/notes/${noteId}/members`, owner.token, {
      method: 'POST',
      body: { userId: viewer.user.userId, role: 'viewer' },
    })

    const editorNote = await request(base, `/api/notes/${noteId}`, editor.token)
    assert.deepEqual(editorNote.note.permissions, { edit: true, comment: true })
    const viewerNote = await request(base, `/api/notes/${noteId}`, viewer.token)
    assert.deepEqual(viewerNote.note.permissions, { edit: false, comment: true })
    await assert.rejects(
      request(base, `/api/notes/${noteId}`, editor.token, { method: 'DELETE' }),
      /403/,
    )

    const viewerSocket = connectRaw(
      `ws://127.0.0.1:${port}/ws/note:${noteId}?token=${encodeURIComponent(viewer.token)}`,
    )
    sockets.push(viewerSocket.ws)
    await viewerSocket.opened
    await viewerSocket.waitForType(MESSAGE_LOADED)
    sendUpdate(viewerSocket.ws, makeUpdate('Viewer edit', 'not allowed'))
    const viewerClose = await viewerSocket.waitForClose()
    assert.equal(viewerClose.code, 4003)

    const comment = await request(base, `/api/notes/${noteId}/comments`, owner.token, {
      method: 'POST',
      body: { body: 'Please take a look @Viewer', mentions: [viewer.user.userId] },
    })
    assert.equal(comment.comment.mentions[0].userId, viewer.user.userId)
    const inbox = await request(base, '/api/mentions', viewer.token)
    assert.equal(inbox.unread, 1)
    assert.equal(inbox.mentions[0].mentioned, true)

    // Everyone on the note gets a notification, even without an @mention.
    const editorInbox = await request(base, '/api/mentions', editor.token)
    assert.equal(editorInbox.unread, 1)
    assert.equal(editorInbox.mentions[0].mentioned, false)

    await request(base, '/api/mentions/read', viewer.token, { method: 'POST', body: {} })
    const readInbox = await request(base, '/api/mentions', viewer.token)
    assert.equal(readInbox.unread, 0)

    const generalComment = await request(base, `/api/notes/${noteId}/comments`, owner.token, {
      method: 'POST',
      body: { body: 'A general update for everyone.', mentions: [] },
    })
    const generalInbox = await request(base, '/api/mentions', viewer.token)
    assert.equal(generalInbox.unread, 1)
    assert.equal(generalInbox.mentions[0].mentioned, false)
    assert.equal(generalInbox.mentions[0].body, 'A general update for everyone.')
    await request(
      base,
      `/api/notes/${noteId}/comments/${generalComment.comment.id}`,
      owner.token,
      { method: 'DELETE' },
    )
    const afterDeleteInbox = await request(base, '/api/mentions', viewer.token)
    assert.equal(afterDeleteInbox.unread, 0)
    assert.equal(
      afterDeleteInbox.mentions.some((item) => item.id === generalComment.comment.id),
      false,
    )

    await request(base, `/api/notes/${noteId}/members/${viewer.user.userId}`, owner.token, {
      method: 'PATCH',
      body: { permissions: { edit: false, comment: false } },
    })
    const noComment = await request(base, `/api/notes/${noteId}`, viewer.token)
    assert.deepEqual(noComment.note.permissions, { edit: false, comment: false })
    await assert.rejects(
      request(base, `/api/notes/${noteId}/comments`, viewer.token, {
        method: 'POST',
        body: { body: 'This should not post.' },
      }),
      /403/,
    )
    await request(base, `/api/notes/${noteId}/members/${viewer.user.userId}`, owner.token, {
      method: 'PATCH',
      body: { permissions: { edit: false, comment: true } },
    })

    const published = await request(base, `/api/notes/${noteId}/public`, owner.token, {
      method: 'POST',
      body: { enabled: true },
    })
    assert.equal(published.enabled, true)
    const publicNote = await request(base, `/api/public/notes/${published.publicToken}`, null)
    assert.equal(publicNote.note.id, noteId)
    const publicSocket = connectRaw(
      `ws://127.0.0.1:${port}/ws/note:${noteId}?share=${encodeURIComponent(published.publicToken)}`,
    )
    sockets.push(publicSocket.ws)
    await publicSocket.opened
    await publicSocket.waitForType(MESSAGE_LOADED)
    sendUpdate(publicSocket.ws, makeUpdate('Public edit', 'not allowed'))
    const publicClose = await publicSocket.waitForClose()
    assert.equal(publicClose.code, 4003)

    const editorTrashProbe = connectRaw(
      `ws://127.0.0.1:${port}/ws/note:${noteId}?token=${encodeURIComponent(editor.token)}`,
    )
    sockets.push(editorTrashProbe.ws)
    await editorTrashProbe.opened
    await editorTrashProbe.waitForType(MESSAGE_LOADED)
    const editorTrashDoc = await readCurrentDoc(editorTrashProbe)
    const beforeEdit = Y.encodeStateVector(editorTrashDoc)
    const firstBlock = editorTrashDoc.getArray('blocks').get(0)
    const blockText = firstBlock?.get('text')
    assert.ok(blockText)
    blockText.insert(blockText.length, ' editor')
    sendUpdate(editorTrashProbe.ws, Y.encodeStateAsUpdate(editorTrashDoc, beforeEdit))
    await editorTrashProbe.waitForType(MESSAGE_SAVED)

    const beforeTrash = Y.encodeStateVector(editorTrashDoc)
    editorTrashDoc.getMap('meta').set('trashed', true)
    sendUpdate(editorTrashProbe.ws, Y.encodeStateAsUpdate(editorTrashDoc, beforeTrash))
    const trashClose = await editorTrashProbe.waitForClose()
    assert.equal(trashClose.code, 4003)
    const stillActive = await request(base, `/api/notes/${noteId}`, owner.token)
    assert.equal(stillActive.note.trashed, false)

    const editorSocket = connectRaw(
      `ws://127.0.0.1:${port}/ws/note:${noteId}?token=${encodeURIComponent(editor.token)}`,
    )
    sockets.push(editorSocket.ws)
    await editorSocket.opened
    await editorSocket.waitForType(MESSAGE_LOADED)

    await request(base, `/api/notes/${noteId}/lock`, owner.token, {
      method: 'POST',
      body: {},
    })
    const lockedOwnerClose = await ownerSocket.waitForClose()
    assert.equal(lockedOwnerClose.code, 4003)
    const lockedEditorClose = await editorSocket.waitForClose()
    assert.equal(lockedEditorClose.code, 4003)

    const readOnlyOwner = connectRaw(
      `ws://127.0.0.1:${port}/ws/note:${noteId}?token=${encodeURIComponent(owner.token)}`,
    )
    sockets.push(readOnlyOwner.ws)
    await readOnlyOwner.opened
    await readOnlyOwner.waitForType(MESSAGE_LOADED)
    sendUpdate(readOnlyOwner.ws, makeUpdate('Locked edit', 'not allowed'))
    const readOnlyOwnerClose = await readOnlyOwner.waitForClose()
    assert.equal(readOnlyOwnerClose.code, 4003)

    const editorAfterLock = connectRaw(
      `ws://127.0.0.1:${port}/ws/note:${noteId}?token=${encodeURIComponent(editor.token)}`,
    )
    sockets.push(editorAfterLock.ws)
    await editorAfterLock.opened
    await editorAfterLock.waitForType(MESSAGE_LOADED)
    await request(base, `/api/notes/${noteId}/members/${editor.user.userId}`, owner.token, {
      method: 'DELETE',
    })
    const removedClose = await editorAfterLock.waitForClose()
    assert.equal(removedClose.code, 4403)

    const eventsSocket = connectRaw(
      `ws://127.0.0.1:${port}/ws/events?token=${encodeURIComponent(editor.token)}`,
    )
    sockets.push(eventsSocket.ws)
    await eventsSocket.opened
    await request(base, '/api/auth/logout', editor.token, { method: 'POST', body: {} })
    const revokedClose = await eventsSocket.waitForClose()
    assert.equal(revokedClose.code, 4401)
  } catch (error) {
    error.message = `${error.message}\n--- server output ---\n${serverOutput}`
    throw error
  }
})
