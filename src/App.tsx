import { AuthProvider, useAuth } from './auth/AuthContext'
import { MobileInputKeyboard } from './components/keyboard/MobileInputKeyboard'
import { AuthScreen } from './screens/AuthScreen'
import { PublicNoteScreen } from './screens/PublicNoteScreen'
import { WorkspaceScreen } from './workspace/WorkspaceScreen'

function Gate() {
  const { status, user, token } = useAuth()

  if (status === 'loading') {
    return (
      <div className="boot">
        <span className="brand__mark" aria-hidden="true">
          Q
        </span>
        <p>Opening your notes…</p>
      </div>
    )
  }

  if (!user || !token) return <AuthScreen />
  return <WorkspaceScreen />
}

export default function App() {
  const publicMatch = window.location.pathname.match(/^\/p\/([A-Za-z0-9]+)\/?$/)
  if (publicMatch) {
    return (
      <>
        <PublicNoteScreen shareToken={publicMatch[1]} />
        <MobileInputKeyboard />
      </>
    )
  }

  return (
    <AuthProvider>
      <Gate />
      <MobileInputKeyboard />
    </AuthProvider>
  )
}
