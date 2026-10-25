import { Check, ChevronUp, Flag, GitMerge, RotateCcw, X } from 'lucide-react'
import { Tooltip } from 'radix-ui'
import { useState } from 'react'
import type { ReviewAction, Report, Urgency } from '../api/types'
import { URGENCY_LABEL } from '../lib/meta'

const URGENCIES: Urgency[] = ['unknown', 'low', 'medium', 'high']

/** Sticky decision bar (UI_UX_SPEC §5.5). Allowed actions follow BACKEND_TECH_SPEC §4.5. */
export function ActionBar({
  report,
  urgency,
  setUrgency,
  note,
  setNote,
  busy,
  stay,
  setStay,
  onAction,
  onRejectClick,
  onMergeClick,
}: {
  report: Report
  urgency: Urgency
  setUrgency: (u: Urgency) => void
  note: string
  setNote: (n: string) => void
  busy: ReviewAction | 'merge' | null
  stay: boolean
  setStay: (s: boolean) => void
  onAction: (a: ReviewAction) => void
  onRejectClick: () => void
  onMergeClick: () => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const s = report.status
  const reviewable = s === 'pending_review' || s === 'flagged'
  const located = report.location.confirmed !== null
  const ai = report.extraction.urgency_suggestion

  if (s === 'merged') {
    return (
      <div className="sticky bottom-0 z-20 border-t border-border bg-surface px-4 py-3 text-sm text-muted">
        This report was merged and can't be approved separately.
      </div>
    )
  }

  return (
    <div className="sticky bottom-0 z-20 border-t border-border bg-surface/95 shadow-[0_-4px_16px_rgb(0_0_0/0.06)] backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-end gap-x-4 gap-y-2 px-4 py-2 md:py-3">
        {/* Under 768 px urgency, note and "stay" fold behind a toggle to keep the bar short. */}
        <button
          type="button"
          className="btn btn-ghost btn-sm w-full justify-between md:hidden"
          aria-expanded={moreOpen}
          aria-controls="action-more"
          onClick={() => setMoreOpen((o) => !o)}
        >
          <span>
            {reviewable ? 'Urgency & note' : 'Options'}
            {reviewable && urgency !== report.urgency && ` · ${URGENCY_LABEL[urgency]}`}
          </span>
          <ChevronUp size={16} aria-hidden="true" className={moreOpen ? '' : 'rotate-180'} />
        </button>
        <div
          id="action-more"
          className={`${moreOpen ? 'flex' : 'hidden'} w-full flex-wrap items-end gap-x-4 gap-y-2 md:flex md:w-auto md:flex-1`}
        >
          {reviewable && (
            <>
              <div>
                <label htmlFor="urgency" className="text-xs font-semibold text-muted">
                  Urgency
                </label>
                <div className="flex items-center gap-2">
                  <select
                    id="urgency"
                    className="input w-32"
                    value={urgency}
                    onChange={(e) => setUrgency(e.target.value as Urgency)}
                    aria-describedby="urgency-help"
                  >
                    {URGENCIES.map((u) => (
                      <option key={u} value={u}>
                        {URGENCY_LABEL[u]}
                      </option>
                    ))}
                  </select>
                  <span id="urgency-help" className="text-xs text-muted">
                    {urgency === report.urgency && report.urgency === 'unknown' && ai
                      ? `AI suggested: ${URGENCY_LABEL[ai].toLowerCase()}`
                      : urgency !== report.urgency
                        ? 'Saved with your next action'
                        : ''}
                  </span>
                </div>
              </div>
              <div className="min-w-48 flex-1">
                <label htmlFor="note" className="text-xs font-semibold text-muted">
                  Note <span className="font-normal">({note.length}/500)</span>
                </label>
                <input
                  id="note"
                  className="input"
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note for the audit trail"
                />
              </div>
            </>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--primary)]"
              checked={stay}
              onChange={(e) => setStay(e.target.checked)}
            />
            Stay on this report
          </label>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          {reviewable ? (
            <>
              {s === 'pending_review' && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => onAction('flag')}
                >
                  <Flag size={15} aria-hidden="true" /> Flag
                </button>
              )}
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy !== null}
                onClick={onRejectClick}
              >
                <X size={15} aria-hidden="true" /> Reject
              </button>
              <button type="button" className="btn" disabled={busy !== null} onClick={onMergeClick}>
                <GitMerge size={15} aria-hidden="true" /> Merge…
              </button>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span tabIndex={located ? -1 : 0} className="inline-flex rounded-lg sm:w-auto">
                    <button
                      type="button"
                      className="btn btn-primary w-full"
                      disabled={!located || busy !== null}
                      onClick={() => onAction('approve')}
                      aria-describedby={located ? undefined : 'approve-help'}
                    >
                      <Check size={15} aria-hidden="true" /> Approve
                    </button>
                  </span>
                </Tooltip.Trigger>
                {!located && (
                  <Tooltip.Portal>
                    <Tooltip.Content
                      sideOffset={6}
                      className="card z-50 px-3 py-1.5 text-sm shadow-pop"
                    >
                      Confirm a location first
                    </Tooltip.Content>
                  </Tooltip.Portal>
                )}
              </Tooltip.Root>
              {!located && (
                <span
                  id="approve-help"
                  className="col-span-2 text-right text-xs text-muted sm:w-auto"
                >
                  Confirm a location first
                </span>
              )}
            </>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => onAction('reopen')}
            >
              <RotateCcw size={15} aria-hidden="true" /> Reopen
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
