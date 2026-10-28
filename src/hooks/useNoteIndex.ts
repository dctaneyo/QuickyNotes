import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api'
import type { NoteSummary } from '../lib/types'

const CACHE_PREFIX = 'quicky.notes.cache.v2'
const QUEUE_PREFIX = 'quicky.notes.queue.v2'

interface Queue {
  create: string[]
  delete: string[]
}

function readCache(key: string): NoteSummary[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((note): note is NoteSummary => !!note && typeof note.id === 'string')
      .map((note) => ({ ...note, tags: Array.isArray(note.tags) ? note.tags : [] }))
  } catch {
    return []
  }
}

function writeCache(key: string, notes: NoteSummary[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(notes))
  } catch {
    // Cache is best effort; the Yjs documents are the real store.
  }
}

function readQueue(key: string): Queue {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { create: [], delete: [] }
    const parsed = JSON.parse(raw) as Queue
    return {
      create: Array.isArray(parsed.create) ? parsed.create : [],
      delete: Array.isArray(parsed.delete) ? parsed.delete : [],
    }
  } catch {
    return { create: [], delete: [] }
  }
}

function writeQueue(key: string, queue: Queue): void {
  try {
    localStorage.setItem(key, JSON.stringify(queue))
  } catch {
    // ignore
  }
}

/**
 * The note list index. Summaries come from the server, are cached per account
 * for offline use, and are updated live from whichever note is open.
 */
export function useNoteIndex(token: string | null, userId: string | null) {
  const cacheKey = `${CACHE_PREFIX}.${userId ?? 'anon'}`
  const queueKey = `${QUEUE_PREFIX}.${userId ?? 'anon'}`
  const [notes, setNotes] = useState<NoteSummary[]>(() => readCache(cacheKey))
  const [syncing, setSyncing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const tokenRef = useRef(token)
  tokenRef.current = token
  const cacheKeyRef = useRef(cacheKey)
  cacheKeyRef.current = cacheKey
  const queueKeyRef = useRef(queueKey)
  queueKeyRef.current = queueKey

  useEffect(() => {
    setNotes(readCache(cacheKey))
  }, [cacheKey])

  useEffect(() => {
    writeCache(cacheKey, notes)
  }, [cacheKey, notes])

  const refresh = useCallback(async () => {
    const currentToken = tokenRef.current
    if (!currentToken) return
    setSyncing(true)
    try {
      const result = await api<{ notes: NoteSummary[] }>('/api/notes', { token: currentToken })
      const queue = readQueue(queueKeyRef.current)
      setNotes((previous) => {
        const localOnly = previous.filter(
          (note) => note.pending || queue.create.includes(note.id),
        )
        const serverIds = new Set(result.notes.map((note) => note.id))
        return [...result.notes, ...localOnly.filter((note) => !serverIds.has(note.id))]
      })
      setLastError(null)
    } catch (error) {
      if (error instanceof ApiError && error.status !== 0) setLastError(error.message)
    } finally {
      setSyncing(false)
    }
  }, [])

  const flush = useCallback(async () => {
    const currentToken = tokenRef.current
    if (!currentToken) return
    const queue = readQueue(queueKeyRef.current)
    let changed = false

    for (const id of [...queue.create]) {
      try {
        await api('/api/notes', { method: 'POST', token: currentToken, body: { id } })
        queue.create = queue.create.filter((value) => value !== id)
        changed = true
      } catch (error) {
        if (error instanceof ApiError && (error.status === 403 || error.status === 409)) {
          queue.create = queue.create.filter((value) => value !== id)
          changed = true
          continue
        }
        break
      }
    }

    for (const id of [...queue.delete]) {
      try {
        await api(`/api/notes/${id}`, { method: 'DELETE', token: currentToken })
        queue.delete = queue.delete.filter((value) => value !== id)
        changed = true
      } catch (error) {
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          queue.delete = queue.delete.filter((value) => value !== id)
          changed = true
          continue
        }
        break
      }
    }

    if (changed) {
      writeQueue(queueKeyRef.current, queue)
      setNotes((previous) =>
        previous.map((note) =>
          queue.create.includes(note.id) ? note : note.pending ? { ...note, pending: false } : note,
        ),
      )
    }
  }, [])

  const registerNote = useCallback(
    async (summary: NoteSummary) => {
      setNotes((previous) => [summary, ...previous.filter((note) => note.id !== summary.id)])
      const queue = readQueue(queueKeyRef.current)
      if (!queue.create.includes(summary.id)) queue.create.push(summary.id)
      writeQueue(queueKeyRef.current, queue)
      await flush()
    },
    [flush],
  )

  const updateSummary = useCallback((summary: NoteSummary) => {
    setNotes((previous) => {
      const existing = previous.find((note) => note.id === summary.id)
      const merged = existing ? { ...summary, pending: existing.pending } : summary
      const rest = previous.filter((note) => note.id !== summary.id)
      return [merged, ...rest]
    })
  }, [])

  const removeLocal = useCallback((id: string) => {
    setNotes((previous) => previous.filter((note) => note.id !== id))
    const queue = readQueue(queueKeyRef.current)
    queue.create = queue.create.filter((value) => value !== id)
    writeQueue(queueKeyRef.current, queue)
  }, [])

  const deleteForever = useCallback(async (id: string) => {
    setNotes((previous) => previous.filter((note) => note.id !== id))
    const queue = readQueue(queueKeyRef.current)
    queue.create = queue.create.filter((value) => value !== id)
    if (!queue.delete.includes(id)) queue.delete.push(id)
    writeQueue(queueKeyRef.current, queue)
    const currentToken = tokenRef.current
    if (!currentToken) return
    try {
      await api(`/api/notes/${id}`, { method: 'DELETE', token: currentToken })
      const latest = readQueue(queueKeyRef.current)
      latest.delete = latest.delete.filter((value) => value !== id)
      writeQueue(queueKeyRef.current, latest)
    } catch {
      // Queued for the next reconnection.
    }
  }, [])

  useEffect(() => {
    if (!token) return
    void (async () => {
      await flush()
      await refresh()
    })()
  }, [token, flush, refresh])

  useEffect(() => {
    if (!token) return
    const onOnline = () => {
      void (async () => {
        await flush()
        await refresh()
      })()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void flush().then(() => refresh())
      }
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refresh()
    }, 60_000)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(interval)
    }
  }, [token, flush, refresh])

  return {
    notes,
    syncing,
    lastError,
    refresh,
    registerNote,
    updateSummary,
    removeLocal,
    deleteForever,
  }
}
