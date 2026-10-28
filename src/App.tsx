import { AuthProvider, useAuth } from './auth/AuthContext'
import { AuthScreen } from './screens/AuthScreen'
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
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
