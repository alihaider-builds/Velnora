import { AlertTriangle, Pin } from 'lucide-react'
import { forwardRef, useId, type ReactNode } from 'react'
import type { Evidence } from '../api/types'
import { UserText } from './UserText'

/**
 * One AI suggestion. Hover or focus highlights its evidence in the original text; click pins
 * the highlight until another card is clicked or Esc is pressed (UI_UX_SPEC §5.5).
 */
export const FieldCard = forwardRef<
  HTMLButtonElement,
  {
    label: string
    value: ReactNode
    evidence: Evidence | null
    shortcut?: number
    active: boolean
    pinned: boolean
    onPreview: (on: boolean) => void
    onPin: () => void
  }
>(function FieldCard({ label, value, evidence, shortcut, active, pinned, onPreview, onPin }, ref) {
  const evidenceId = useId()
  const unmatched = evidence !== null && !evidence.matched

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pinned}
      aria-describedby={evidence ? evidenceId : undefined}
      onMouseEnter={() => onPreview(true)}
      onMouseLeave={() => onPreview(false)}
      onFocus={() => onPreview(true)}
      onBlur={() => onPreview(false)}
      onClick={onPin}
      className={`w-full rounded-lg border-[1.5px] border-dashed px-3 py-2 text-left transition-colors ${
        active ? 'border-ai bg-ai-soft' : 'border-ai/60 bg-surface hover:bg-ai-soft'
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-xs font-semibold tracking-wide text-muted uppercase">
            {label}
          </span>
          <span className="mt-0.5 block font-semibold">{value}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-muted">
          {pinned && <Pin size={14} aria-hidden="true" className="text-ai" />}
          {shortcut !== undefined && shortcut <= 9 && <kbd aria-hidden="true">{shortcut}</kbd>}
        </span>
      </span>
      {evidence &&
        (unmatched ? (
          <span
            id={evidenceId}
            className="mt-1 flex items-start gap-1.5 text-sm font-medium text-flagged"
          >
            <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              Evidence not found — check manually
              {evidence.phrase && (
                <span className="block font-normal text-muted">
                  AI quoted: “<UserText text={evidence.phrase} />”
                </span>
              )}
            </span>
          </span>
        ) : (
          <span id={evidenceId} className="mt-1 block text-sm text-muted italic">
            “<UserText text={evidence.phrase} />”
          </span>
        ))}
    </button>
  )
})
