import { Navigate, Outlet, useLocation } from 'react-router'
import { useMe } from '../api/hooks'
import { ErrorState, Spinner } from './ui'

/** Reviewer routes call GET /api/auth/me; on 401 redirect to /review/login?next=<path> (§4). */
export function RequireReviewer() {
  const location = useLocation()
  const me = useMe()

  if (me.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-muted">
        <Spinner label="Checking sign-in…" />
      </div>
    )
  }
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />
  if (me.data === null) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/review/login?next=${next}`} replace />
  }
  return <Outlet />
}
