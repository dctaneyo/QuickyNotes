import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { NoteHistoryEntry } from '../lib/types'
import type { Realtime } from '../sync/useEvents'

/**
 * History is fetched only while the activity view is open. A history:changed
 * event on the existing event socket refreshes it; there is no polling.
 */
export function useNoteHistory(
  noteId: string | null,
  token: string | null,
  subscribe: Realtime['subscribe'],
  open: boolean,
) {
  const [entries, setEntries] = useState<NoteHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!open || !noteId || !token) return
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    setError(null)
    api<{ entries: NoteHistoryEntry[] }>(`/api/notes/${noteId}/history?limit=80`, {
      token,
      signal: controller.signal,
    })
      .then((data) => {
        if (cancelled) return
        setEntries(Array.isArray(data.entries) ? data.entries : [])
      })
      .catch((cause) => {
        if (cancelled || cause?.name === 'AbortError') return
        setError(cause instanceof Error ? cause.message : 'Could not load this note’s history.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [open, noteId, token, version])

  useEffect(() => {
    if (!open || !noteId) return
    return subscribe((event) => {
      if (event.type === 'history:changed' && event.noteId === noteId) {
        setVersion((value) => value + 1)
      }
    })
  }, [open, noteId, subscribe])

  const refresh = useCallback(() => setVersion((value) => value + 1), [])

  return { entries, loading, error, refresh }
}
