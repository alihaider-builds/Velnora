import { FlaskConical, WifiOff } from 'lucide-react'
import { useDemoMode } from '../api/hooks'
import { useServerUnreachable } from '../api/queryClient'

/** Slim, non-dismissible bar shown when /api/health reports demo_mode (UI_UX_SPEC §4). */
export function DemoBanner() {
  const demoMode = useDemoMode()
  if (!demoMode) return null

  return (
    <div
      role="note"
      className="flex items-center justify-center gap-2 border-b border-banner-border bg-banner px-4 py-1.5 text-center text-sm font-medium text-banner-text"
    >
      <FlaskConical size={15} aria-hidden="true" className="shrink-0" />
      Demo data — all reports here are synthetic.
    </div>
  )
}

/** §5.7 — shown when requests fail repeatedly; hides itself once a request succeeds. */
export function NetworkBanner() {
  const unreachable = useServerUnreachable()
  if (!unreachable) return null

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-rejected/40 bg-rejected px-4 py-1.5 text-sm font-medium text-white"
    >
      <WifiOff size={15} aria-hidden="true" />
      Can't reach the server — retrying…
    </div>
  )
}
