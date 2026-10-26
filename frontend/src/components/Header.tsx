import { LogOut, Menu, Phone, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { useHelplines, useLogout, useMe } from '../api/hooks'
import { formatPhone } from '../lib/format'
import { Logo } from './Logo'

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium',
    isActive ? 'bg-surface-2 text-primary' : 'text-text hover:bg-surface-2',
  ].join(' ')
}

/** The active helpline number(s), tappable to call. Shown in the header on every page. */
function HelplineLink() {
  const lines = useHelplines().data?.items ?? []
  if (!lines.length) return null
  const h = lines[0]
  return (
    <a
      href={`tel:${h.number}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-text hover:bg-surface-2"
      aria-label={`Call the helpline ${formatPhone(h.number)}`}
    >
      <Phone size={15} aria-hidden="true" className="text-primary" />
      <span className="hidden text-muted sm:inline">Helpline</span>
      <span dir="ltr" className="tabular-nums">
        {formatPhone(h.number)}
      </span>
    </a>
  )
}

/** Header on every page (UI_UX_SPEC §4); collapses into a menu below 768 px. */
export function Header() {
  const { data: me } = useMe()
  const logout = useLogout()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  // Close the mobile menu whenever the route changes.
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const signOut = () =>
    logout.mutate(undefined, { onSettled: () => navigate('/review/login', { replace: true }) })

  const links = (
    <>
      <li>
        <NavLink to="/" end className={navClass}>
          Map
        </NavLink>
      </li>
      <li>
        <NavLink to="/submit" className={navClass}>
          Submit a report
        </NavLink>
      </li>
      <li>
        <NavLink to="/review" className={navClass}>
          Review
        </NavLink>
      </li>
      {me && (
        <li>
          <button
            type="button"
            onClick={signOut}
            disabled={logout.isPending}
            className="inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium text-text hover:bg-surface-2"
          >
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </li>
      )}
    </>
  )

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div aria-hidden="true" className="h-[3px] bg-[var(--primary)]" />
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 px-4 py-2">
        <Link
          to="/"
          className="flex min-h-11 items-center rounded-lg"
          aria-label="ReliefLens — home"
        >
          <Logo />
        </Link>

        {/* On small phones the helpline gets its own line below the logo, so nothing is cut off. */}
        <div className="order-last -ml-3 flex w-full items-center gap-1 sm:order-none sm:ml-auto sm:w-auto">
          <HelplineLink />
          <nav aria-label="Main" className="hidden border-l border-border pl-1 md:block">
            <ul className="flex items-center gap-1">{links}</ul>
          </nav>
        </div>

        <button
          type="button"
          className="btn btn-ghost px-3 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          <span>Menu</span>
        </button>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          aria-label="Main"
          className="border-t border-border px-4 py-2 md:hidden"
        >
          <ul className="flex flex-col gap-1">{links}</ul>
        </nav>
      )}
    </header>
  )
}
