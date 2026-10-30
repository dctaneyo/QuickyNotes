import { useCallback, useEffect, useRef, useState } from 'react'
import { websocketBase } from '../lib/api'
import type { AdminSnapshot } from '../lib/admin'
import type { CustomTemplate } from '../lib/templates'
import type { NoteSummary, SyncState } from '../lib/types'

export type RealtimeEvent =
  | { type: 'notes:snapshot'; notes: NoteSummary[] }
  | { type: 'templates:snapshot'; templates: CustomTemplate[] }
  | { type: 'history:changed'; noteId: string }
  | { type: 'comments:changed'; noteId: string }
  | { type: 'mentions:changed' }
  | ({ type: 'admin:snapshot' } & AdminSnapshot)

type Listener = (event: RealtimeEvent) => void

export interface Realtime {
  status: SyncState
  /** Retained so a console opened later still has the latest snapshot. */
  adminSnapshot: AdminSnapshot | null
  templates: CustomTemplate[]
  subscribe: (listener: Listener) => () => void
  requestAdmin: () => void
  requestTemplates: () => void
  retry: () => void
}

/**
 * One WebSocket per signed-in browser carries every pushed snapshot. There is
 * no polling here: reconnects use backoff, and the server sends fresh state on
 * connect and after each change.
 */
export function useEvents(token: string | null): Realtime {
  const [status, setStatus] = useState<SyncState>(() =>
    token && typeof navigator !== 'undefined' && navigator.onLine ? 'connecting' : 'offline',
  )
  const [adminSnapshot, setAdminSnapshot] = useState<AdminSnapshot | null>(null)
  const [templates, setTemplates] = useState<CustomTemplate[]>([])
  const [retryNonce, setRetryNonce] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)
  const listeners = useRef(new Set<Listener>())
  const retryRef = useRef(0)

  useEffect(() => {
    setAdminSnapshot(null)
    setTemplates([])
    if (!token) {
      setStatus('offline')
      return
    }
    let disposed = false
    let timer: number | null = null
    const online = typeof navigator === 'undefined' ? true : navigator.onLine
    setStatus(online ? 'connecting' : 'offline')

    const connect = () => {
      if (disposed) return
      const socket = new WebSocket(`${websocketBase()}/events?token=${encodeURIComponent(token)}`)
      socketRef.current = socket
      setStatus('connecting')
      socket.onopen = () => {
        retryRef.current = 0
        setStatus('online')
      }
      socket.onmessage = (message) => {
        let event: RealtimeEvent
        try {
          event = JSON.parse(String(message.data)) as RealtimeEvent
        } catch {
          return
        }
        if (!event || typeof event.type !== 'string') return
        if (event.type === 'admin:snapshot') {
          setAdminSnapshot({ users: event.users, stats: event.stats, audit: event.audit })
        }
        if (event.type === 'templates:snapshot') setTemplates(event.templates)
        for (const listener of listeners.current) listener(event)
      }
      socket.onclose = (event) => {
        socketRef.current = null
        if (disposed) return
        if (event.code === 4001 || event.code === 4401) {
          // The account was suspended or the session was revoked; stop
          // reconnecting until the user signs in again.
          setStatus('offline')
          return
        }
        if (event.code === 4002) {
          // The admin changed this account's ID; reload with the new identity.
          window.location.reload()
          return
        }
        setStatus(navigator.onLine ? 'connecting' : 'offline')
        const delay = Math.min(1000 * 2 ** retryRef.current, 15_000)
        retryRef.current += 1
        timer = window.setTimeout(connect, delay)
      }
      socket.onerror = () => {}
    }

    connect()
    const onOnline = () => {
      if (socketRef.current) return
      if (timer) window.clearTimeout(timer)
      retryRef.current = 0
      connect()
    }
    window.addEventListener('online', onOnline)
    return () => {
      disposed = true
      if (timer) window.clearTimeout(timer)
      window.removeEventListener('online', onOnline)
      socketRef.current?.close(1000, 'Leaving')
      socketRef.current = null
    }
  }, [token, retryNonce])

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const requestAdmin = useCallback(() => {
    const socket = socketRef.current
    if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'admin:refresh' }))
  }, [])

  const requestTemplates = useCallback(() => {
    const socket = socketRef.current
    if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'templates:refresh' }))
  }, [])

  const retry = useCallback(() => {
    const socket = socketRef.current
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return
    setRetryNonce((value) => value + 1)
  }, [])

  return { status, adminSnapshot, templates, subscribe, requestAdmin, requestTemplates, retry }
}
