import { AlertTriangle, RotateCw } from 'lucide-react'
import { Outlet, ScrollRestoration } from 'react-router'
import { DemoBanner, NetworkBanner } from './DemoBanner'
import { Header } from './Header'

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:inline-flex focus:min-h-11 focus:items-center"
      >
        Skip to content
      </a>
      <Header />
      <DemoBanner />
      <NetworkBanner />
      <main id="main" className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <ScrollRestoration />
    </div>
  )
}

/** Global error boundary (UI_UX_SPEC §5.7). */
export function RouteError() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <AlertTriangle size={32} aria-hidden="true" className="text-rejected" />
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-muted">
        The page hit an unexpected error. Reloading usually fixes it.
      </p>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
        <RotateCw size={16} aria-hidden="true" /> Reload
      </button>
    </div>
  )
}
