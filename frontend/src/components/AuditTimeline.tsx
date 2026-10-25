import { History } from 'lucide-react'
import type { AuditEntry } from '../api/types'
import { clockTime, exactTime } from '../lib/format'

const VERB: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
  flag: 'flagged',
  reopen: 'reopened',
  merge: 'merged',
  confirm_location: 'confirmed the location',
  edit_fields: 'edited fields',
  set_urgency: 'set urgency',
  reveal_original: 'viewed the original',
}

/** Collapsible audit trail (UI_UX_SPEC §5.5, P1). */
export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  return (
    <details className="card group px-4 py-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold">
        <History size={16} aria-hidden="true" className="text-muted" />
        History <span className="text-sm font-normal text-muted">({entries.length})</span>
        <span className="ml-auto text-sm font-normal text-primary group-open:hidden">Show</span>
        <span className="ml-auto hidden text-sm font-normal text-primary group-open:inline">
          Hide
        </span>
      </summary>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No actions yet.</p>
      ) : (
        <ol className="mt-3 flex flex-col border-l-2 border-border pl-4">
          {[...entries].reverse().map((e, i) => (
            <li key={`${e.at}-${i}`} className="relative pb-3 text-sm last:pb-0">
              <span
                className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full bg-primary"
                aria-hidden="true"
              />
              <time dateTime={e.at} title={exactTime(e.at)} className="font-mono text-muted">
                {clockTime(e.at)}
              </time>{' '}
              · <span className="capitalize">{e.actor}</span>{' '}
              {VERB[e.action] ?? e.action.replace(/_/g, ' ')}
              {e.note && <span className="text-muted"> · Note: {e.note}</span>}
            </li>
          ))}
        </ol>
      )}
    </details>
  )
}
