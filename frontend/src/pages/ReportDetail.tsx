import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Eye, Keyboard, MapPin, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, ApiError } from '../api/client'
import { keys, useOriginal, useReport, useReports, useReview } from '../api/hooks'
import type { OriginalResponse, ReportListResponse, ReviewAction, Urgency } from '../api/types'
import { ActionBar } from '../components/ActionBar'
import { AiSuggestions, evidenceFields } from '../components/AiSuggestions'
import { AuditTimeline } from '../components/AuditTimeline'
import { ChannelBadge, DemoTag, LanguageBadge, StatusBadge } from '../components/badges'
import { ConfirmDialog, Dialog } from '../components/Dialog'
import { DuplicatesPanel, MergePicker } from '../components/Duplicates'
import { EvidenceText, type HighlightRange } from '../components/EvidenceText'
import { LocationPicker } from '../components/LocationPicker'
import { PriorityWhy } from '../components/Priority'
import { useToast } from '../components/Toast'
import { EmptyState, ErrorState, Skeleton, errorMessage } from '../components/ui'
import { UserText } from '../components/UserText'
import { exactTime, formatCoords, relativeTime } from '../lib/format'
import { CHANNELS } from '../lib/meta'

const EXTRACTION_TIMEOUT_MS = 120_000

const SHORTCUTS: [string, string][] = [
  ['A', 'Approve'],
  ['R', 'Reject'],
  ['F', 'Flag'],
  ['M', 'Merge'],
  ['E', 'Edit fields'],
  ['L', 'Focus location search'],
  ['1–9', 'Focus AI field cards'],
  ['Esc', 'Clear highlight'],
  ['J / K', 'Next / previous report'],
  ['?', 'Show this help'],
]

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

const ACTION_DONE: Record<ReviewAction, string> = {
  approve: 'approved',
  reject: 'rejected',
  flag: 'flagged',
  reopen: 'reopened',
}

function Section({
  n,
  title,
  children,
  aside,
}: {
  n: number
  title: string
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <section className="card flex flex-col gap-3 p-4" aria-labelledby={`col-${n}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={`col-${n}`} className="flex items-center gap-2 text-base font-semibold">
          <span className="text-xs font-semibold text-muted">{n}</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Keyed by id so every piece of per-report state resets when moving between reports. */
export function ReportDetail() {
  const { id = '' } = useParams()
  return <ReportDetailView key={id} id={id} />
}

function ReportDetailView({ id }: { id: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  // §5.5: poll every 2 s while extracting; stop after 120 s and offer a retry.
  const [pollStart, setPollStart] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const stalled = now - pollStart > EXTRACTION_TIMEOUT_MS
  const query = useReport(id, { pollExtraction: !stalled })
  const report = query.data
  const extracting =
    report?.extraction.status === 'pending' || report?.extraction.status === 'running'
  useEffect(() => {
    if (!extracting) return
    const t = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(t)
  }, [extracting])

  // Queue order for J/K and "next pending report".
  const queue = useReports({ status: ['pending_review'], sort: 'priority', page_size: 100 })

  const review = useReview(id)
  const original = useOriginal(id)
  const [revealed, setRevealed] = useState<OriginalResponse | null>(null)

  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<false | 'edit' | 'blank'>(false)
  const [urgency, setUrgency] = useState<Urgency>('unknown')
  const [note, setNote] = useState('')
  const [stay, setStay] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [merging, setMerging] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  const [urgencyFor, setUrgencyFor] = useState<string | null>(null)
  if (report && urgencyFor !== `${report.id}:${report.urgency}`) {
    setUrgencyFor(`${report.id}:${report.urgency}`)
    setUrgency(report.urgency)
  }

  const fields = useMemo(() => (report ? evidenceFields(report.extraction) : []), [report])
  const activeKey = hoverKey ?? pinnedKey
  const highlight: HighlightRange | null = useMemo(() => {
    const f = fields.find((x) => x.key === activeKey)
    if (!f || !f.evidence.matched || f.evidence.start === null || f.evidence.end === null)
      return null
    return { start: f.evidence.start, end: f.evidence.end, label: `Evidence for ${f.name}` }
  }, [fields, activeKey])

  const queueIds = useMemo(() => queue.data?.items.map((r) => r.id) ?? [], [queue.data])

  const goNext = useCallback(async () => {
    try {
      const res = await qc.fetchQuery({
        queryKey: keys.reports({ status: ['pending_review'], sort: 'priority', page_size: 2 }),
        queryFn: () =>
          api.get<ReportListResponse>('/api/reports', {
            status: ['pending_review'],
            sort: 'priority',
            page_size: 2,
          }),
        staleTime: 0,
      })
      const next = res.items.find((r) => r.id !== id)
      navigate(next ? `/review/reports/${next.id}` : '/review')
    } catch {
      navigate('/review')
    }
  }, [qc, id, navigate])

  const act = useCallback(
    (action: ReviewAction) => {
      if (!report) return
      setActionError(null)
      review.mutate(
        {
          action,
          urgency: urgency !== report.urgency ? urgency : undefined,
          note: note.trim() || undefined,
        },
        {
          onSuccess: (r) => {
            toast(`${r.reference} ${ACTION_DONE[action]}.`)
            setNote('')
            setRejecting(false)
            if (!stay && action !== 'reopen') void goNext()
          },
          onError: (err) => {
            const msg =
              err instanceof ApiError && err.code === 'LOCATION_REQUIRED'
                ? 'Confirm a location before approving.'
                : errorMessage(err, `Couldn't ${action} this report.`)
            setActionError(msg)
            setRejecting(false)
            toast(msg, 'error')
          },
        },
      )
    },
    [report, review, urgency, note, toast, stay, goNext],
  )

  // Keyboard shortcuts (§5.5) — disabled while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!document.querySelector('[role="dialog"]')) {
          setPinnedKey(null)
          setHoverKey(null)
        }
        return
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || !report) return
      if (document.querySelector('[role="dialog"]')) return
      const reviewable = report.status === 'pending_review' || report.status === 'flagged'
      const k = e.key.toLowerCase()
      const handled = () => e.preventDefault()

      if (e.key === '?') return (handled(), setHelpOpen(true))
      if (/^[1-9]$/.test(e.key)) {
        const el = cardRefs.current[Number(e.key) - 1]
        if (el) {
          handled()
          el.focus()
        }
        return
      }
      if (k === 'j' || k === 'k') {
        const idx = queueIds.indexOf(report.id)
        const target =
          k === 'j' ? (queueIds[idx + 1] ?? (idx < 0 ? queueIds[0] : undefined)) : queueIds[idx - 1]
        if (target) {
          handled()
          navigate(`/review/reports/${target}`)
        }
        return
      }
      if (k === 'e' && report.status !== 'merged') return (handled(), setEditing('edit'))
      if (k === 'l') {
        if (searchRef.current) {
          handled()
          searchRef.current.focus()
        }
        return
      }
      if (!reviewable || review.isPending) return
      if (k === 'a' && report.location.confirmed) return (handled(), act('approve'))
      if (k === 'r') return (handled(), setRejecting(true))
      if (k === 'f' && report.status === 'pending_review') return (handled(), act('flag'))
      if (k === 'm') return (handled(), setMerging(true))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [report, queueIds, navigate, act, review.isPending])

  if (query.isPending) {
    return (
      <div className="mx-auto grid w-full max-w-[1600px] gap-4 px-4 py-6 xl:grid-cols-3">
        <Skeleton className="h-20 xl:col-span-3" />
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    )
  }
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return (
        <div className="mx-auto w-full max-w-xl px-4 py-12">
          <div className="card">
            <EmptyState title="Report not found.">
              <Link to="/review" className="link">
                Back to the queue
              </Link>
            </EmptyState>
          </div>
        </div>
      )
    }
    return (
      <ErrorState
        error={query.error}
        onRetry={() => query.refetch()}
        title="Couldn't load this report."
      />
    )
  }
  if (!report) return null

  const text = revealed?.source_text ?? report.masked_text
  const ChannelIcon = CHANNELS[report.channel].icon
  const isMessage = report.channel !== 'web'
  const loc = report.location

  return (
    <div className="flex flex-1 flex-col">
      {/* Header — channel, sender, priority */}
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Link to="/review" className="btn btn-ghost btn-sm -ml-2">
              <ArrowLeft size={16} aria-hidden="true" /> Queue
            </Link>
            <h1 className="font-mono text-xl font-bold">{report.reference}</h1>
            <ChannelBadge channel={report.channel} />
            {report.sender && (
              <span className="font-mono text-sm" dir="ltr">
                {revealed?.sender ?? report.sender.masked}
              </span>
            )}
            <LanguageBadge language={report.extraction.language} />
            <time
              dateTime={report.created_at}
              title={exactTime(report.created_at)}
              className="text-sm text-muted"
            >
              {relativeTime(report.created_at)}
            </time>
            <button
              type="button"
              className="btn btn-ghost btn-sm ml-auto hidden md:inline-flex"
              onClick={() => setHelpOpen(true)}
            >
              <Keyboard size={15} aria-hidden="true" /> Shortcuts <kbd aria-hidden="true">?</kbd>
            </button>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            {report.priority && <PriorityWhy priority={report.priority} />}
            <StatusBadge status={report.status} />
            {report.is_synthetic && <DemoTag />}
            {report.sender && report.sender.same_sender_count > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium">
                <Users size={13} aria-hidden="true" />
                This number sent {report.sender.same_sender_count} other report
                {report.sender.same_sender_count > 1 ? 's' : ''} in the last 24 h
              </span>
            )}
            {report.merged_into && (
              <Link
                to={`/review/reports/${report.merged_into}`}
                className="link inline-flex min-h-11 items-center text-sm"
              >
                Open the report it was merged into
              </Link>
            )}
          </div>
          {actionError && (
            <p role="alert" className="text-sm font-medium text-rejected">
              {actionError}
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1600px] flex-1 items-start gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Column 1 — Original report */}
        <Section n={1} title="Original report" aside={<span className="eyebrow">Reported</span>}>
          <div
            className={
              isMessage
                ? 'rounded-2xl rounded-bl-md p-4'
                : 'rounded-md border-l-4 border-historical bg-surface-2 px-4 py-3'
            }
            style={
              isMessage
                ? {
                    backgroundColor:
                      report.channel === 'whatsapp' ? 'var(--chat-wa-me)' : 'var(--chat-sms-me)',
                  }
                : undefined
            }
          >
            {isMessage && (
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
                <ChannelIcon size={13} aria-hidden="true" /> {CHANNELS[report.channel].label}{' '}
                message
              </p>
            )}
            <EvidenceText text={text} highlight={highlight} id="report-text" />
          </div>

          {revealed ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-flagged">
              <Eye size={15} aria-hidden="true" /> Viewing original — this action is logged.
            </p>
          ) : (
            <button
              type="button"
              className="btn btn-sm self-start"
              disabled={original.isPending}
              onClick={() =>
                original.mutate(undefined, {
                  onSuccess: (o) => {
                    setRevealed(o)
                    qc.invalidateQueries({ queryKey: keys.report(id) })
                  },
                  onError: (err) =>
                    toast(errorMessage(err, "Couldn't load the original."), 'error'),
                })
              }
            >
              <Eye size={14} aria-hidden="true" /> Reveal original
            </button>
          )}

          {report.has_image && report.image_url && (
            <div>
              <button
                type="button"
                className="overflow-hidden rounded-lg border border-border"
                onClick={() => setPhotoOpen(true)}
                aria-label="Enlarge submitted photo"
              >
                <img
                  src={report.image_url}
                  alt="Submitted photo"
                  className="h-28 w-40 object-cover"
                />
              </button>
              <p className="mt-1 text-xs text-muted">
                Submitted photo — not proof of the situation.
              </p>
            </div>
          )}

          {(loc.submitted_text || loc.submitted_point) && (
            <p className="flex items-start gap-1.5 text-sm">
              <MapPin size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
              <span>
                Submitter said:{' '}
                {loc.submitted_text && (
                  <UserText text={loc.submitted_text} className="font-medium" />
                )}
                {loc.submitted_point && (
                  <span className="text-muted">
                    {loc.submitted_text ? ' · ' : ''}pin at{' '}
                    {formatCoords(loc.submitted_point.lat, loc.submitted_point.lng)}
                  </span>
                )}
              </span>
            </p>
          )}
        </Section>

        {/* Column 2 — AI suggestions */}
        <div className="card p-4">
          <AiSuggestions
            report={report}
            activeKey={activeKey}
            pinnedKey={pinnedKey}
            onPreview={setHoverKey}
            onPin={(key) => setPinnedKey((cur) => (cur === key ? null : key))}
            cardRefs={cardRefs}
            editing={editing}
            setEditing={setEditing}
            stalled={stalled}
            onRetryPoll={() => {
              setPollStart(Date.now())
              setNow(Date.now())
              void query.refetch()
            }}
          />
        </div>

        {/* Column 3 — Location and duplicates (below columns 1–2 under 1280 px) */}
        <div className="flex flex-col gap-4 md:col-span-2 md:grid md:grid-cols-2 xl:col-span-1 xl:flex">
          <Section n={3} title="Location">
            <LocationPicker key={report.id} report={report} searchRef={searchRef} />
          </Section>
          <Section n={4} title="Possible duplicates">
            <DuplicatesPanel report={report} note={note} onMerged={() => setNote('')} />
          </Section>
        </div>

        <div className="md:col-span-2 xl:col-span-3">
          <AuditTimeline entries={report.audit} />
        </div>
      </div>

      <ActionBar
        report={report}
        urgency={urgency}
        setUrgency={setUrgency}
        note={note}
        setNote={setNote}
        busy={review.isPending ? (review.variables?.action ?? 'approve') : null}
        stay={stay}
        setStay={setStay}
        onAction={act}
        onRejectClick={() => setRejecting(true)}
        onMergeClick={() => setMerging(true)}
      />

      <ConfirmDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Reject ${report.reference}?`}
        description="The report stays in the record but won't appear on the public map. You can reopen it later."
        confirmLabel="Reject"
        danger
        busy={review.isPending}
        onConfirm={() => act('reject')}
      />
      {merging && (
        <MergePicker
          report={report}
          open={merging}
          onOpenChange={setMerging}
          note={note}
          onMerged={() => {
            setNote('')
            if (!stay) void goNext()
          }}
        />
      )}
      {report.image_url && (
        <Dialog
          open={photoOpen}
          onOpenChange={setPhotoOpen}
          title="Submitted photo"
          description="Submitted photo — not proof of the situation."
          wide
        >
          <img
            src={report.image_url}
            alt="Submitted photo, enlarged"
            className="mx-auto max-h-[70vh] rounded-lg"
          />
        </Dialog>
      )}
      <Dialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="Keyboard shortcuts"
        description="Shortcuts are disabled while typing in a field."
      >
        <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
          {SHORTCUTS.map(([k, label]) => (
            <div key={k} className="contents">
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </div>
  )
}
