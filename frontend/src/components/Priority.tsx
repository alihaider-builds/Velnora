import { ChevronDown, HelpCircle } from 'lucide-react'
import { Popover, Tooltip } from 'radix-ui'
import { useId, useState } from 'react'
import type { Priority } from '../api/types'
import { PriorityBadge } from './badges'

const EXPLAINER =
  "Priority combines the AI's urgency suggestion (or your own urgency once set), the most serious need, and how long the report has been waiting. It only orders your work — it never sends anything."

function ReasonList({ reasons }: { reasons: string[] }) {
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {reasons.map((r) => (
        <li key={r} className="flex gap-2">
          <span aria-hidden="true">•</span>
          {r}
        </li>
      ))}
    </ul>
  )
}

/** Queue badge: hover or keyboard focus shows the reasons (UI_UX_SPEC §5.4). */
export function PriorityBadgeWithReasons({ priority }: { priority: Priority | null }) {
  if (!priority) return <span className="text-sm text-muted">—</span>
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-full"
          aria-label={`${priority.level} priority, score ${priority.score}. Reasons: ${priority.reasons.join('; ')}`}
        >
          <PriorityBadge level={priority.level} score={priority.score} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={6}
          className="card z-50 max-w-72 px-3 py-2 shadow-pop"
        >
          <p className="mb-1 text-xs font-semibold text-muted">Why this priority</p>
          <ReasonList reasons={priority.reasons} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** Detail header: badge plus a "Why?" toggle listing the reasons (UI_UX_SPEC §5.5). */
export function PriorityWhy({ priority }: { priority: Priority }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <PriorityBadge level={priority.level} score={priority.score} />
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:bg-surface-2"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          Why?
          <ChevronDown size={14} aria-hidden="true" className={open ? 'rotate-180' : ''} />
        </button>
      </div>
      {open && (
        <div id={id} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
          <ReasonList reasons={priority.reasons} />
          <p className="mt-1 text-xs text-muted">
            {priority.urgency_source === 'reviewer'
              ? 'Uses the urgency you set.'
              : 'Uses the AI urgency suggestion until you set urgency.'}
          </p>
        </div>
      )}
    </div>
  )
}

export function PriorityHelp() {
  return (
    <Popover.Root>
      <Popover.Trigger className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-primary hover:bg-surface-2">
        <HelpCircle size={15} aria-hidden="true" /> How is priority calculated?
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="end"
          className="card z-50 max-w-80 p-4 text-sm shadow-pop"
        >
          {EXPLAINER}
          <Popover.Arrow className="fill-[var(--surface)]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
