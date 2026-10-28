import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { websocketBase } from '../lib/api'
import { colorFor } from '../lib/notes'
import type { SyncState } from '../lib/types'
import type { Peer } from './useNoteSync'

interface AwarenessShape {
  user?: { userId?: string; displayName?: string; color?: string }
  noteId?: string | null
}

/**
 * A document-less room used only for presence: who is around, and which note
 * they are looking at. Keeps the connection indicator meaningful even when no
 * note is open.
 */
export function useLobby(
  token: string | null,
  userId: string | null,
  displayName: string | null,
) {
  const [peers, setPeers] = useState<Peer[]>([])
  const [connected, setConnected] = useState(false)
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
    if (!token || !userId) return
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(websocketBase(), 'lobby', doc, { params: { token } })
    provider.awareness.setLocalStateField('user', {
      userId,
      displayName: displayName ?? userId,
      color: colorFor(userId),
    })

    const onAwareness = () => {
      const states = [...provider.awareness.getStates().entries()]
      const next: Peer[] = []
      for (const [clientId, state] of states) {
        if (clientId === provider.awareness.clientID) continue
        const shape = state as AwarenessShape
        if (!shape.user?.userId) continue
        next.push({
          clientId,
          userId: shape.user.userId,
          displayName: shape.user.displayName || shape.user.userId,
          color: shape.user.color || colorFor(shape.user.userId),
          focus: null,
          cursor: null,
        })
      }
      setPeers(next)
    }

    provider.awareness.on('change', onAwareness)
    provider.on('status', (event: { status: string }) => setConnected(event.status === 'connected'))
    providerRef.current = provider
    setConnected(provider.wsconnected)
    onAwareness()

    return () => {
      provider.awareness.off('change', onAwareness)
      provider.destroy()
      doc.destroy()
      providerRef.current = null
      setPeers([])
      setConnected(false)
    }
  }, [token, userId, displayName])

  const setActiveNote = (noteId: string | null) => {
    providerRef.current?.awareness.setLocalStateField('noteId', noteId)
  }

  const retry = () => providerRef.current?.connect()

  const status: SyncState = !browserOnline ? 'offline' : connected ? 'online' : 'connecting'

  return { peers, status, retry, setActiveNote }
}
