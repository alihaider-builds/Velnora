import { Columns2, GitMerge } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useDuplicates, useMerge, useReport } from '../api/hooks'
import type { DuplicateCandidate, MergeRequest, Report } from '../api/types'
import { exactTime, relativeTime } from '../lib/format'
import { ChannelBadge, NeedChip, StatusBadge } from './badges'
import { ConfirmDialog, Dialog } from './Dialog'
import { useToast } from './Toast'
import { EmptyState, ErrorState, Skeleton, Spinner, errorMessage } from './ui'
import { UserText } from './UserText'

const canMerge = (r: Report) => r.status === 'pending_review' || r.status === 'flagged'
const isTarget = (status: Report['status']) => status !== 'merged' && status !== 'rejected'

export function DuplicateCard({
  candidate,
  onCompare,
}: {
  candidate: DuplicateCandidate
  onCompare: () => void
}) {
  const pct = Math.round(candidate.score * 100)
  return (
    <article className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span>Match</span>
            <span>{candidate.score.toFixed(2)}</span>
          </div>
          <div
            role="meter"
            aria-label="Duplicate match score"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={candidate.score}
            className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={onCompare}>
          <Columns2 size={14} aria-hidden="true" /> Compare
        </button>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1">
        {candidate.reasons.map((r) => (
          <li key={r} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
            {r}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
        {candidate.summary.needs.map((n) => (
          <NeedChip key={n} need={n} />
        ))}
        <UserText
          text={candidate.summary.place ?? ''}
          className={candidate.summary.place ? '' : 'text-muted'}
        >
          {candidate.summary.place ?? 'No place'}
        </UserText>
        <span className="text-muted">·</span>
        <time
          dateTime={candidate.summary.created_at}
          title={exactTime(candidate.summary.created_at)}
          className="text-muted"
        >
          {relativeTime(candidate.summary.created_at)}
        </time>
        <StatusBadge status={candidate.summary.status} />
      </div>
    </article>
  )
}

function ReportColumn({ report, title }: { report: Report; title: string }) {
  const needs = report.reviewer_fields.needs ?? report.extraction.needs.map((n) => n.category)
  const qty =
    report.reviewer_fields.quantities ??
    report.extraction.quantities.map((q) => ({ value: q.value, label: q.label }))
  const place = report.reviewer_fields.place_name ?? report.extraction.place_name?.text ?? null
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="eyebrow">{title}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/review/reports/${report.id}`} className="font-mono font-semibold text-primary">
          {report.reference}
        </Link>
        <ChannelBadge channel={report.channel} />
        <StatusBadge status={report.status} />
      </div>
      <blockquote className="rounded-md border-l-4 border-historical bg-surface-2 px-3 py-2">
        <UserText text={report.masked_text} as="p" className="whitespace-pre-wrap" />
      </blockquote>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-sm">
        <dt className="text-muted">Needs</dt>
        <dd className="flex flex-wrap gap-1">
          {needs.length ? needs.map((n) => <NeedChip key={n} need={n} />) : '—'}
        </dd>
        <dt className="text-muted">Quantities</dt>
        <dd>{qty.length ? qty.map((q) => `${q.value} ${q.label}`).join(', ') : '—'}</dd>
        <dt className="text-muted">Place</dt>
        <dd>{place ? <UserText text={place} /> : '—'}</dd>
        <dt className="text-muted">Received</dt>
        <dd title={exactTime(report.created_at)}>{relativeTime(report.created_at)}</dd>
      </dl>
    </div>
  )
}

/** MergeRequest with the reviewer's action-bar note when there is one (§4.4 `note` is optional). */
function mergeBody(targetId: string, note?: string): MergeRequest {
  const n = note?.trim()
  return n ? { target_id: targetId, note: n } : { target_id: targetId }
}

function NotePreview({ note }: { note?: string }) {
  if (!note?.trim()) return null
  return (
    <span className="mt-3 block rounded-md bg-surface-2 px-3 py-2 text-sm text-text">
      <span className="font-semibold">Note saved with the merge:</span> {note.trim()}
    </span>
  )
}

/** Side-by-side compare; "Merge into this one" merges the other report into the current one. */
export function CompareDialog({
  current,
  otherId,
  onClose,
  note,
  onMerged,
}: {
  current: Report
  otherId: string
  onClose: () => void
  note?: string
  onMerged?: () => void
}) {
  const other = useReport(otherId, { pollExtraction: false })
  const merge = useMerge(otherId)
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)

  const o = other.data
  const allowed = o && canMerge(o) && isTarget(current.status)

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => !open && onClose()}
        title="Compare reports"
        description="Masked text and fields side by side."
        wide
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!allowed}
              onClick={() => setConfirming(true)}
            >
              <GitMerge size={15} aria-hidden="true" /> Merge into this one
            </button>
          </>
        }
      >
        {other.isPending ? (
          <Skeleton className="h-48" />
        ) : other.isError ? (
          <ErrorState error={other.error} onRetry={() => other.refetch()} />
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <ReportColumn report={current} title="This report" />
            <ReportColumn report={other.data} title="Possible duplicate" />
          </div>
        )}
        {o && !allowed && (
          <p className="mt-4 text-sm text-muted">
            Only pending or flagged reports can be merged, into a report that isn't rejected or
            merged.
          </p>
        )}
      </Dialog>
      {o && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Merge reports?"
          description={
            <>
              Merge {o.reference} into {current.reference}? The merged report stays in the record
              and can't be approved separately.
              <NotePreview note={note} />
            </>
          }
          confirmLabel="Merge"
          busy={merge.isPending}
          onConfirm={() =>
            merge.mutate(mergeBody(current.id, note), {
              onSuccess: () => {
                toast(`${o.reference} merged into ${current.reference}.`)
                setConfirming(false)
                onMerged?.()
                onClose()
              },
              onError: (err) => toast(errorMessage(err, "Couldn't merge."), 'error'),
            })
          }
        />
      )}
    </>
  )
}

export function DuplicatesPanel({
  report,
  note,
  onMerged,
}: {
  report: Report
  note?: string
  onMerged?: () => void
}) {
  const dups = useDuplicates(report.id)
  const [comparing, setComparing] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-2">
      {dups.isPending ? (
        <Skeleton className="h-24" />
      ) : dups.isError ? (
        <ErrorState error={dups.error} onRetry={() => dups.refetch()} />
      ) : dups.data.candidates.length === 0 ? (
        <EmptyState title="No likely duplicates found." />
      ) : (
        dups.data.candidates.map((c) => (
          <DuplicateCard
            key={c.report_id}
            candidate={c}
            onCompare={() => setComparing(c.report_id)}
          />
        ))
      )}
      {comparing && (
        <CompareDialog
          current={report}
          otherId={comparing}
          note={note}
          onMerged={onMerged}
          onClose={() => setComparing(null)}
        />
      )}
    </div>
  )
}

/** Action-bar "Merge…": pick a duplicate and merge this report into it. */
export function MergePicker({
  report,
  open,
  onOpenChange,
  onMerged,
  note,
}: {
  report: Report
  open: boolean
  onOpenChange: (o: boolean) => void
  onMerged: () => void
  note?: string
}) {
  const dups = useDuplicates(report.id, open)
  const merge = useMerge(report.id)
  const toast = useToast()
  const [target, setTarget] = useState<DuplicateCandidate | null>(null)
  const targets = (dups.data?.candidates ?? []).filter((c) => isTarget(c.summary.status))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Merge ${report.reference} into…`}
      description={
        <>
          Choose the report this one duplicates. The merged report stays in the record and can't be
          approved separately.
          <NotePreview note={note} />
        </>
      }
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!target || merge.isPending}
            onClick={() =>
              target &&
              merge.mutate(mergeBody(target.report_id, note), {
                onSuccess: () => {
                  toast(`${report.reference} merged.`)
                  onOpenChange(false)
                  onMerged()
                },
                onError: (err) => toast(errorMessage(err, "Couldn't merge."), 'error'),
              })
            }
          >
            {merge.isPending ? <Spinner label="Merging…" /> : 'Merge'}
          </button>
        </>
      }
    >
      {dups.isPending ? (
        <Skeleton className="h-24" />
      ) : targets.length === 0 ? (
        <EmptyState title="No likely duplicates to merge into." />
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Merge target</legend>
          {targets.map((c) => (
            <label
              key={c.report_id}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${target?.report_id === c.report_id ? 'border-primary bg-surface-2' : 'border-border'}`}
            >
              <input
                type="radio"
                name="merge-target"
                className="mt-1 accent-[var(--primary)]"
                checked={target?.report_id === c.report_id}
                onChange={() => setTarget(c)}
              />
              <span className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="font-semibold">
                  Score {c.score.toFixed(2)} · {c.summary.place ?? 'No place'} ·{' '}
                  {relativeTime(c.summary.created_at)}
                </span>
                <span className="text-muted">{c.reasons.join(' · ')}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Dialog>
  )
}
