/**
 * ReliefLens mark: a map pin (place) holding a lens (seeing what is reported) with a check
 * (verified by a reviewer). Colours follow the theme tokens.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        d="M16 1.5C9 1.5 3.5 7 3.5 13.8 3.5 22.6 16 30.5 16 30.5S28.5 22.6 28.5 13.8C28.5 7 23 1.5 16 1.5Z"
        fill="var(--primary)"
      />
      <circle cx="16" cy="13.6" r="7.4" fill="var(--surface)" />
      <path
        d="M12.4 13.8l2.6 2.6 4.8-5.2"
        fill="none"
        stroke="var(--verified)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Logo({ showTagline = true }: { showTagline?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={34} />
      <span className="flex flex-col leading-tight">
        <span className="text-xl font-bold tracking-tight text-text">
          Relief<span className="text-primary">Lens</span>
        </span>
        {showTagline && (
          <span className="hidden text-xs text-muted lg:block">
            Turn scattered disaster reports into structured, reviewable evidence.
          </span>
        )}
      </span>
    </span>
  )
}
