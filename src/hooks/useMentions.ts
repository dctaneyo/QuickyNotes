import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { MentionItem } from '../lib/types'
import type { Realtime } from '../sync/useEvents'

/** The mention inbox is account-wide and updates over the event socket. */
export function useMentions(token: string | null, subscribe: Realtime['subscribe']) {
  const [mentions, setMentions] = useState<MentionItem[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!token) {
      setMentions([])
      setUnread(0)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    api<{ mentions: MentionItem[]; unread: number }>('/api/mentions', {
      token,
      signal: controller.signal,
    })
      .then((data) => {
        if (cancelled) return
        setMentions(Array.isArray(data.mentions) ? data.mentions : [])
        setUnread(Number(data.unread) || 0)
      })
      .catch((cause) => {
        if (cancelled || cause?.name === 'AbortError') return
        setError(cause instanceof Error ? cause.message : 'Could not load mentions.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [token, version])

  useEffect(() => {
    if (!token) return
    return subscribe((event) => {
      if (event.type === 'mentions:changed') setVersion((value) => value + 1)
    })
  }, [token, subscribe])

  const refresh = useCallback(() => setVersion((value) => value + 1), [])

  const markRead = useCallback(async () => {
    if (!token || unread === 0) return
    await api('/api/mentions/read', { method: 'POST', token, body: {} })
    setUnread(0)
    setMentions((previous) => previous.map((mention) => ({ ...mention, readAt: mention.readAt || Date.now() })))
  }, [token, unread])

  return { mentions, unread, loading, error, refresh, markRead }
}
