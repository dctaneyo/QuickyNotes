import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ApiError,
  api,
  clearSession,
  readSession,
  writeSession,
  type SessionUser,
} from '../lib/api'

type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

interface AuthValue {
  user: SessionUser | null
  token: string | null
  status: AuthStatus
  signIn: (userId: string, pin: string) => Promise<void>
  signUp: (pin: string, displayName: string) => Promise<{ user: SessionUser; firstAccount: boolean }>
  enterWorkspace: () => void
  signOut: () => Promise<void>
  setName: (displayName: string) => Promise<void>
  changePin: (currentPin: string, newPin: string) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const pending = useRef<{ token: string; user: SessionUser } | null>(null)

  useEffect(() => {
    const stored = readSession()
    if (!stored) {
      setStatus('signed-out')
      return
    }
    setUser(stored.user)
    setToken(stored.token)
    setStatus('signed-in')

    // Revalidate in the background. A network failure keeps you signed in so
    // the app still opens offline; only a real 401 signs you out.
    api<{ user: SessionUser }>('/api/auth/me', { token: stored.token })
      .then((result) => {
        setUser(result.user)
        writeSession({ token: stored.token, user: result.user })
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          clearSession()
          setUser(null)
          setToken(null)
          setStatus('signed-out')
        }
      })
  }, [])

  const signIn = useCallback(async (userId: string, pin: string) => {
    const result = await api<{ token: string; user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: { userId, pin },
    })
    writeSession(result)
    setUser(result.user)
    setToken(result.token)
    setStatus('signed-in')
  }, [])

  const signUp = useCallback(async (pin: string, displayName: string) => {
    const result = await api<{ token: string; user: SessionUser; firstAccount: boolean }>(
      '/api/auth/signup',
      { method: 'POST', body: { pin, displayName } },
    )
    // Held back until the person has acknowledged their new ID.
    pending.current = { token: result.token, user: result.user }
    return { user: result.user, firstAccount: result.firstAccount }
  }, [])

  const enterWorkspace = useCallback(() => {
    const next = pending.current
    if (!next) return
    pending.current = null
    writeSession(next)
    setUser(next.user)
    setToken(next.token)
    setStatus('signed-in')
  }, [])

  const signOut = useCallback(async () => {
    const current = token
    clearSession()
    setUser(null)
    setToken(null)
    setStatus('signed-out')
    if (current) {
      try {
        await api('/api/auth/logout', { method: 'POST', token: current })
      } catch {
        // Signing out locally is what matters; the token expires on its own.
      }
    }
  }, [token])

  const setName = useCallback(
    async (displayName: string) => {
      const result = await api<{ user: SessionUser }>('/api/auth/me', {
        method: 'PATCH',
        body: { displayName },
        token,
      })
      setUser(result.user)
      if (token) writeSession({ token, user: result.user })
    },
    [token],
  )

  const changePin = useCallback(
    async (currentPin: string, newPin: string) => {
      await api('/api/auth/pin', { method: 'POST', body: { currentPin, newPin }, token })
    },
    [token],
  )

  const value = useMemo<AuthValue>(
    () => ({ user, token, status, signIn, signUp, enterWorkspace, signOut, setName, changePin }),
    [user, token, status, signIn, signUp, enterWorkspace, signOut, setName, changePin],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
