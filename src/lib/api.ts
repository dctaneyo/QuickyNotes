const SESSION_KEY = 'quicky.session.v1'

export interface SessionUser {
  userId: string
  displayName: string
  isAdmin: boolean
}

export interface StoredSession {
  token: string
  user: SessionUser
}

export class ApiError extends Error {
  status: number
  retryAfter?: number
  remaining?: number

  constructor(message: string, status: number, extra?: { retryAfter?: number; remaining?: number }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfter = extra?.retryAfter
    this.remaining = extra?.remaining
  }
}

export function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (!parsed?.token || !parsed.user?.userId) return null
    return parsed
  } catch {
    return null
  }
}

export function writeSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  token?: string | null
  signal?: AbortSignal
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.token) headers.Authorization = `Bearer ${options.token}`

  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new ApiError('The server could not be reached.', 0)
  }

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string; retryAfter?: number; remaining?: number }
    throw new ApiError(payload.error || `Request failed (${response.status}).`, response.status, {
      retryAfter: payload.retryAfter,
      remaining: payload.remaining,
    })
  }

  return (data ?? {}) as T
}

export function websocketBase(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}
