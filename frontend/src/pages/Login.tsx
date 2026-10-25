import { KeyRound, LogIn } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '../api/client'
import { useLogin, useMe } from '../api/hooks'
import { LogoMark } from '../components/Logo'
import { Spinner } from '../components/ui'
import { USE_MOCKS } from '../lib/config'

/** Only allow in-app paths as the post-login destination. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/review'
}

export function Login() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const me = useMe()
  const login = useLogin()
  const [password, setPassword] = useState('')
  const next = safeNext(params.get('next'))

  if (me.data) return <Navigate to={next} replace />

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!password) return
    login.mutate(password, { onSuccess: () => navigate(next, { replace: true }) })
  }

  const err = login.error
  const message =
    err instanceof ApiError
      ? err.status === 401
        ? 'Incorrect password'
        : err.status === 429
          ? 'Too many attempts, wait a minute'
          : err.message
      : err
        ? 'Something went wrong. Try again.'
        : null

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="card w-full max-w-sm p-6 sm:p-8">
        <LogoMark size={40} />
        <h1 className="mt-4 text-2xl font-bold">Reviewer sign-in</h1>
        <p className="mt-1 text-sm text-muted">Reports are only visible to signed-in reviewers.</p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="password" className="label">
              Reviewer password
            </label>
            <div className="relative">
              <KeyRound
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
              />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="input pl-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={message ? true : undefined}
                aria-describedby={message ? 'login-error' : undefined}
                autoFocus
              />
            </div>
            {message && (
              <p id="login-error" role="alert" className="mt-1 text-sm font-medium text-rejected">
                {message}
              </p>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={!password || login.isPending}>
            {login.isPending ? (
              <Spinner label="Signing in…" />
            ) : (
              <>
                <LogIn size={16} aria-hidden="true" /> Sign in
              </>
            )}
          </button>
        </form>

        {USE_MOCKS && (
          <p className="mt-6 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
            Mock mode: the mock backend accepts the password set in{' '}
            <code>VITE_MOCK_REVIEWER_PASSWORD</code> (default <code>demo</code>). The real backend
            uses its own reviewer password.
          </p>
        )}
      </div>
    </div>
  )
}
