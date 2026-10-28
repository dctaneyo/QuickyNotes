import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api'
import type { NoteSummary } from '../lib/types'
import type { Realtime } from '../sync/useEvents'

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
export function useNoteIndex(
  token: string | null,
  userId: string | null,
  events: Realtime,
) {
  const { subscribe } = events
  const cacheKey = `${CACHE_PREFIX}.${userId ?? 'anon'}`
  const queueKey = `${QUEUE_PREFIX}.${userId ?? 'anon'}`
  const [notes, setNotes] = useState<NoteSummary[]>(() => readCache(cacheKey))
  const [syncing, setSyncing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const notesRef = useRef(notes)
  notesRef.current = notes
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

  const emptyTrash = useCallback(async () => {
    const currentToken = tokenRef.current
    if (!currentToken) throw new Error('Sign in again to empty the trash.')
    const trashed = notesRef.current
      .filter((note) => note.trashed)
      .map((note) => note.id)
    await api('/api/notes/trash', { method: 'DELETE', token: currentToken })
    setNotes((previous) => previous.filter((note) => !note.trashed))
    const queue = readQueue(queueKeyRef.current)
    const removed = new Set(trashed)
    queue.create = queue.create.filter((id) => !removed.has(id))
    queue.delete = queue.delete.filter((id) => !removed.has(id))
    writeQueue(queueKeyRef.current, queue)
  }, [])

  useEffect(() => {
    if (!token) return
    void flush()
  }, [token, flush])

  useEffect(() => {
    if (!token) return
    const onOnline = () => {
      void flush()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void flush()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [token, flush])

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== 'notes:snapshot') return
      const queue = readQueue(queueKeyRef.current)
      const deleted = new Set(queue.delete)
      setNotes((previous) => {
        const localOnly = previous.filter(
          (note) =>
            (note.pending || queue.create.includes(note.id)) && !deleted.has(note.id),
        )
        const serverNotes = event.notes.filter((note) => !deleted.has(note.id))
        const serverIds = new Set(serverNotes.map((note) => note.id))
        return [...serverNotes, ...localOnly.filter((note) => !serverIds.has(note.id))]
      })
      setLastError(null)
      setSyncing(false)
    })
  }, [subscribe])

  return {
    notes,
    syncing,
    lastError,
    registerNote,
    updateSummary,
    removeLocal,
    deleteForever,
    emptyTrash,
  }
}
