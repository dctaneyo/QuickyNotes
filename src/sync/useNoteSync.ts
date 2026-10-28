import { useCallback, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence } from 'y-indexeddb'
import { websocketBase } from '../lib/api'
import { colorFor } from '../lib/notes'
import type { SyncState } from '../lib/types'
import { takeSeed } from './seeds'

export interface Peer {
  clientId: number
  userId: string
  displayName: string
  color: string
  focus: string | null
  cursor: { blockId: string; index: number; at: number } | null
}

interface AwarenessShape {
  user?: { userId?: string; displayName?: string; color?: string }
  focus?: string | null
  cursor?: { blockId?: unknown; index?: unknown; at?: unknown } | null
}

export function useNoteSync(
  noteId: string | null,
  token: string | null,
  userId: string | null,
  displayName: string | null,
) {
  const [doc, setDoc] = useState<Y.Doc | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const [connected, setConnected] = useState(false)
  const [synced, setSynced] = useState(false)
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const providerRef = useRef<WebsocketProvider | null>(null)
  const cursorFrameRef = useRef<number | null>(null)
  const pendingCursorRef = useRef<{ blockId: string | null; index: number } | null>(null)
  const lastCursorRef = useRef<{ blockId: string; index: number } | null>(null)

  useEffect(() => {
    const onOnline = () => setBrowserOnline(true)
    const onOffline = () => setBrowserOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (!noteId || !token || !userId) {
      setDoc(null)
      setPeers([])
      return
    }

    const nextDoc = new Y.Doc()
    const seed = takeSeed(noteId)
    if (seed) Y.applyUpdate(nextDoc, seed, 'seed')

    // Scoped by account so one person's local drafts never appear for another.
    const persistence = new IndexeddbPersistence(`quicky-note-v1-${userId}-${noteId}`, nextDoc)
    const provider = new WebsocketProvider(websocketBase(), `note:${noteId}`, nextDoc, {
      params: { token },
    })
    provider.awareness.setLocalStateField('user', {
      userId,
      displayName: displayName ?? userId,
      color: colorFor(userId),
    })

    setSynced(persistence.synced === true)
    persistence.on('synced', () => setSynced(true))
    provider.on('status', (event: { status: string }) => setConnected(event.status === 'connected'))
    provider.on('sync', (value: boolean) => setSynced(value))

    const onAwareness = () => {
      const states = [...provider.awareness.getStates().entries()]
      const next: Peer[] = []
      for (const [clientId, state] of states) {
        if (clientId === provider.awareness.clientID) continue
        const shape = state as AwarenessShape
        const user = shape.user
        if (!user?.userId) continue
        const rawCursor = shape.cursor
        const cursor =
          rawCursor &&
          typeof rawCursor.blockId === 'string' &&
          typeof rawCursor.index === 'number' &&
          Number.isFinite(rawCursor.index)
            ? {
                blockId: rawCursor.blockId,
                index: Math.max(0, Math.floor(rawCursor.index)),
                at: typeof rawCursor.at === 'number' ? rawCursor.at : 0,
              }
            : typeof shape.focus === 'string'
              ? { blockId: shape.focus, index: 0, at: 0 }
              : null
        next.push({
          clientId,
          userId: user.userId,
          displayName: user.displayName || user.userId,
          color: user.color || colorFor(user.userId),
          focus: typeof shape.focus === 'string' ? shape.focus : null,
          cursor,
        })
      }
      // Two tabs of the same person should not paint two carets.
      const byUser = new Map<string, Peer>()
      for (const peer of next) {
        const existing = byUser.get(peer.userId)
        if (!existing) {
          byUser.set(peer.userId, peer)
          continue
        }
        const peerAt = peer.cursor?.at ?? 0
        const existingAt = existing.cursor?.at ?? 0
        if (peerAt > existingAt || (peerAt === existingAt && peer.clientId > existing.clientId)) {
          byUser.set(peer.userId, peer)
        }
      }
      const unique = [...byUser.values()]

      setPeers((previous) => {
        if (previous.length !== unique.length) return unique
        for (let index = 0; index < unique.length; index += 1) {
          const before = previous[index]
          const after = unique[index]
          if (
            before.clientId !== after.clientId ||
            before.userId !== after.userId ||
            before.displayName !== after.displayName ||
            before.color !== after.color ||
            before.focus !== after.focus ||
            before.cursor?.blockId !== after.cursor?.blockId ||
            before.cursor?.index !== after.cursor?.index
          ) {
            return unique
          }
        }
        return previous
      })
    }
    provider.awareness.on('change', onAwareness)
    onAwareness()

    providerRef.current = provider
    setDoc(nextDoc)
    setConnected(provider.wsconnected)

    return () => {
      provider.awareness.off('change', onAwareness)
      provider.destroy()
      persistence.destroy()
      if (cursorFrameRef.current !== null) {
        window.cancelAnimationFrame(cursorFrameRef.current)
        cursorFrameRef.current = null
      }
      pendingCursorRef.current = null
      providerRef.current = null
      setDoc((current) => {
        if (current) current.destroy()
        return null
      })
      setPeers([])
      setConnected(false)
      setSynced(false)
    }
  }, [noteId, token, userId, displayName])

  const setCursor = useCallback((blockId: string | null, index = 0) => {
    pendingCursorRef.current = {
      blockId,
      index: Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0,
    }
    if (cursorFrameRef.current !== null) return
    cursorFrameRef.current = window.requestAnimationFrame(() => {
      cursorFrameRef.current = null
      const next = pendingCursorRef.current
      pendingCursorRef.current = null
      const awareness = providerRef.current?.awareness
      if (!next || !awareness) return
      const current = (awareness.getLocalState() ?? {}) as AwarenessShape
      if (!next.blockId) {
        if (current.focus != null || current.cursor != null) {
          awareness.setLocalState({ ...current, focus: null, cursor: null })
        }
        return
      }
      const cursor = { blockId: next.blockId, index: next.index, at: Date.now() }
      lastCursorRef.current = { blockId: next.blockId, index: next.index }
      if (
        current.focus === next.blockId &&
        current.cursor?.blockId === next.blockId &&
        current.cursor?.index === next.index
      ) {
        return
      }
      awareness.setLocalState({ ...current, focus: next.blockId, cursor })
    })
  }, [])

  // A caret left behind in a background tab should not sit in the note forever.
  useEffect(() => {
    const clear = () => {
      const awareness = providerRef.current?.awareness
      if (!awareness) return
      const current = (awareness.getLocalState() ?? {}) as AwarenessShape
      if (current.focus == null && current.cursor == null) return
      awareness.setLocalState({ ...current, focus: null, cursor: null })
    }
    const restore = () => {
      if (document.visibilityState === 'hidden') return
      if (!(document.activeElement instanceof HTMLTextAreaElement)) return
      const last = lastCursorRef.current
      if (last) setCursor(last.blockId, last.index)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clear()
      else restore()
    }
    window.addEventListener('blur', clear)
    window.addEventListener('focus', restore)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', clear)
      window.removeEventListener('focus', restore)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [setCursor])

  const retry = useCallback(() => {
    providerRef.current?.connect()
  }, [])

  const status: SyncState = !browserOnline ? 'offline' : connected ? 'online' : 'connecting'

  return { doc, peers, status, synced, setCursor, retry, browserOnline }
}
