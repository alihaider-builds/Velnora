import { AlertTriangle, Inbox, Loader2, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError } from '../api/client'

export function Spinner({ label, size = 16 }: { label?: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2" role={label ? 'status' : undefined}>
      <Loader2 size={size} className="animate-spin" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />
}

export function EmptyState({
  title,
  children,
  icon = <Inbox size={28} aria-hidden="true" />,
}: {
  title: string
  children?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="text-muted">{icon}</span>
      <p className="font-semibold">{title}</p>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- small helper shared with the state components
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.code.startsWith('HTTP_5')) return "Can't reach the server."
    return error.message || fallback
  }
  return fallback
}

/** Inline error with a retry button — used for every failed load (UI_UX_SPEC §5). */
export function ErrorState({
  error,
  onRetry,
  title = "Couldn't load this.",
}: {
  error: unknown
  onRetry?: () => void
  title?: string
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <AlertTriangle size={24} aria-hidden="true" className="text-rejected" />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          <RotateCw size={14} aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  )
}

export function Callout({
  tone = 'info',
  icon,
  children,
}: {
  tone?: 'info' | 'warn' | 'good'
  icon?: ReactNode
  children: ReactNode
}) {
  const color =
    tone === 'warn' ? 'var(--flagged)' : tone === 'good' ? 'var(--verified)' : 'var(--primary)'
  return (
    <div
      className="flex gap-2 rounded-md border-l-4 px-3 py-2 text-sm"
      style={{
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 9%, var(--surface))`,
      }}
    >
      {icon && (
        <span className="mt-0.5 shrink-0" style={{ color }}>
          {icon}
        </span>
      )}
      <div>{children}</div>
    </div>
  )
}
