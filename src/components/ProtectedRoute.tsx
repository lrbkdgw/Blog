import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthed, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ink-200 border-t-brand-500 dark:border-white/[0.12] dark:border-t-brand-400" />
      </div>
    )
  }

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  return <>{children}</>
}
