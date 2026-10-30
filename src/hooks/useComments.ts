import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { NoteComment } from '../lib/types'
import type { Realtime } from '../sync/useEvents'

/** Comments refresh from the existing event socket; there is no polling. */
export function useComments(
  noteId: string | null,
  token: string | null,
  subscribe: Realtime['subscribe'],
  open: boolean,
) {
  const [comments, setComments] = useState<NoteComment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!open || !noteId || !token) return
    const controller = new AbortController()
    let cancelled = false
    setLoading(true)
    setError(null)
    api<{ comments: NoteComment[] }>(`/api/notes/${noteId}/comments`, {
      token,
      signal: controller.signal,
    })
      .then((data) => {
        if (!cancelled) setComments(Array.isArray(data.comments) ? data.comments : [])
      })
      .catch((cause) => {
        if (cancelled || cause?.name === 'AbortError') return
        setError(cause instanceof Error ? cause.message : 'Could not load comments.')
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
      if (event.type === 'comments:changed' && event.noteId === noteId) {
        setVersion((value) => value + 1)
      }
    })
  }, [open, noteId, subscribe])

  const add = useCallback(
    async (body: string, mentions: string[]) => {
      if (!noteId || !token) throw new Error('Sign in again to comment.')
      setBusy(true)
      try {
        const data = await api<{ comment: NoteComment }>(`/api/notes/${noteId}/comments`, {
          method: 'POST',
          token,
          body: { body, mentions },
        })
        setComments((previous) => [...previous, data.comment])
        return data.comment
      } finally {
        setBusy(false)
      }
    },
    [noteId, token],
  )

  const resolve = useCallback(
    async (commentId: string, resolved: boolean) => {
      if (!noteId || !token) throw new Error('Sign in again to comment.')
      const data = await api<{ comment: NoteComment }>(
        `/api/notes/${noteId}/comments/${commentId}`,
        {
          method: 'PATCH',
          token,
          body: { resolved },
        },
      )
      setComments((previous) =>
        previous.map((comment) => (comment.id === commentId ? data.comment : comment)),
      )
      return data.comment
    },
    [noteId, token],
  )

  const remove = useCallback(
    async (commentId: string) => {
      if (!noteId || !token) throw new Error('Sign in again to comment.')
      await api(`/api/notes/${noteId}/comments/${commentId}`, { method: 'DELETE', token })
      setComments((previous) => previous.filter((comment) => comment.id !== commentId))
    },
    [noteId, token],
  )

  const refresh = useCallback(() => setVersion((value) => value + 1), [])

  return { comments, loading, error, busy, add, resolve, remove, refresh }
}
