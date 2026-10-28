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
}

interface AwarenessShape {
  user?: { userId?: string; displayName?: string; color?: string }
  focus?: string | null
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
        next.push({
          clientId,
          userId: user.userId,
          displayName: user.displayName || user.userId,
          color: user.color || colorFor(user.userId),
          focus: typeof shape.focus === 'string' ? shape.focus : null,
        })
      }
      setPeers(next)
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

  const setFocus = useCallback((blockId: string | null) => {
    providerRef.current?.awareness.setLocalStateField('focus', blockId)
  }, [])

  const retry = useCallback(() => {
    providerRef.current?.connect()
  }, [])

  const status: SyncState = !browserOnline ? 'offline' : connected ? 'online' : 'connecting'

  return { doc, peers, status, synced, setFocus, retry, browserOnline }
}
