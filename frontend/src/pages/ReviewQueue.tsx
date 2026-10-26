import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Copy,
  LayoutDashboard,
  Loader2,
  MapPin,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useNeeds, useReports, useStats } from '../api/hooks'
import type {
  Channel,
  NeedCategory,
  ReportListItem,
  ReportListParams,
  ReportSort,
  ReportStatus,
  Urgency,
} from '../api/types'
import {
  ChannelBadge,
  DemoTag,
  LanguageBadge,
  NeedChip,
  StatusBadge,
  UrgencyBadge,
} from '../components/badges'
import { UserText } from '../components/UserText'
import { EmptyState, ErrorState, Skeleton } from '../components/ui'
import { exactTime, relativeTime } from '../lib/format'
import { CHANNEL_ORDER, CHANNELS, URGENCY_LABEL } from '../lib/meta'

const URGENCY_FILTERS: Urgency[] = ['high', 'medium', 'low', 'unknown']

const PAGE_SIZE = 25

const TABS: { key: string; label: string; statuses: ReportStatus[] }[] = [
  { key: 'pending', label: 'Pending', statuses: ['pending_review'] },
  { key: 'flagged', label: 'Flagged', statuses: ['flagged'] },
  { key: 'approved', label: 'Approved', statuses: ['approved'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
  { key: 'merged', label: 'Merged', statuses: ['merged'] },
  { key: 'all', label: 'All', statuses: [] },
]

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function Row({
  item,
  selected,
  moved,
  linkRef,
  onSelect,
}: {
  item: ReportListItem
  selected: boolean
  moved: boolean
  linkRef: (el: HTMLAnchorElement | null) => void
  onSelect: () => void
}) {
  const navigate = useNavigate()
  const transcribing = item.transcript_status === 'pending' || item.transcript_status === 'running'
  const extracting =
    !transcribing && (item.extraction_status === 'pending' || item.extraction_status === 'running')
  const needsTranscript = item.transcript_status === 'failed'
  const href = `/review/reports/${item.id}`

  return (
    <li
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a,button')) navigate(href)
      }}
      className={`group grid cursor-pointer grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-b border-border px-4 py-3 last:border-b-0 hover:bg-surface-2 lg:grid-cols-[8.5rem_7rem_minmax(0,1fr)_11rem_6.5rem_6rem] lg:items-center ${
        selected ? 'bg-surface-2 shadow-[inset_3px_0_0_var(--primary)]' : ''
      } ${moved ? 'row-moved' : ''}`}
    >
      <div className="row-span-2 flex flex-col items-start gap-1 lg:row-span-1">
        <time
          dateTime={item.created_at}
          title={exactTime(item.created_at)}
          className="text-sm font-semibold"
        >
          {relativeTime(item.created_at)}
        </time>
        <UrgencyBadge urgency={item.urgency} />
      </div>

      <div className="hidden lg:block">
        <ChannelBadge channel={item.channel} />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            ref={linkRef}
            to={href}
            onFocus={onSelect}
            // 44 px hit area; the negative margin keeps the row height unchanged.
            className="-my-3 inline-flex min-h-11 items-center font-mono text-sm font-semibold text-primary hover:underline"
          >
            {item.reference}
          </Link>
          <span className="lg:hidden">
            <ChannelBadge channel={item.channel} />
          </span>
          <LanguageBadge language={item.language} />
          {item.is_synthetic && (
            <span className="hidden xl:inline">
              <DemoTag />
            </span>
          )}
          {extracting && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ai">
              <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Reading…
            </span>
          )}
          {transcribing && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ai">
              <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Transcribing call…
            </span>
          )}
          {needsTranscript && (
            <span className="inline-flex items-center gap-1 rounded-full border border-flagged px-2 py-0.5 text-xs font-semibold text-flagged">
              <AlertTriangle size={12} aria-hidden="true" /> Needs transcript
            </span>
          )}
          {item.extraction_status === 'failed' && !needsTranscript && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rejected px-2 py-0.5 text-xs font-semibold text-white">
              <AlertTriangle size={12} aria-hidden="true" /> Extraction failed
            </span>
          )}
          {item.duplicate_count > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium">
              <Copy size={12} aria-hidden="true" />
              {item.duplicate_count} possible duplicate{item.duplicate_count > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <UserText text={item.preview} as="p" className="mt-1 line-clamp-2 text-sm text-text">
          {item.preview}
          {item.preview.length >= 80 ? '…' : ''}
        </UserText>
      </div>

      <div className="col-start-2 flex flex-wrap items-center gap-1.5 lg:col-start-auto">
        {item.needs.map((n) => (
          <NeedChip key={n} need={n} />
        ))}
        {item.needs.length === 0 && !extracting && !transcribing && (
          <span className="text-sm text-muted">No needs yet</span>
        )}
        <span className="flex items-center gap-1 text-sm lg:hidden">
          <MapPin
            size={14}
            aria-hidden="true"
            className={item.has_confirmed_location ? 'fill-verified text-verified' : 'text-muted'}
          />
          <span className={item.place ? '' : 'text-muted'}>{item.place ?? 'No place'}</span>
        </span>
      </div>

      <div className="hidden min-w-0 items-center gap-1 text-sm lg:flex">
        <MapPin
          size={15}
          aria-hidden="true"
          className={`shrink-0 ${item.has_confirmed_location ? 'fill-verified text-verified' : 'text-muted'}`}
        />
        <span className="sr-only">
          {item.has_confirmed_location ? 'Location confirmed.' : 'Location not confirmed.'}
        </span>
        <UserText text={item.place ?? ''} className={`truncate ${item.place ? '' : 'text-muted'}`}>
          {item.place ?? 'No place'}
        </UserText>
      </div>

      <div className="col-start-2 flex flex-wrap items-center gap-2 lg:col-start-auto lg:flex-col lg:items-end lg:gap-1">
        <StatusBadge status={item.status} />
      </div>
    </li>
  )
}

export function ReviewQueue() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((t) => t.key === params.get('tab')) ?? TABS[0]
  const need = (params.get('need') as NeedCategory | null) ?? undefined
  const channels = params.getAll('channel') as Channel[]
  const urgencies = params.getAll('urgency') as Urgency[]
  const sort: ReportSort = params.get('sort') === 'oldest' ? 'oldest' : 'newest'
  const { order: needKeys, meta } = useNeeds()
  const page = Math.max(1, Number(params.get('page') ?? 1))
  const qParam = params.get('q') ?? ''
  const [search, setSearch] = useState(qParam)

  const update = (patch: Record<string, string | string[] | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      next.delete(k)
      if (Array.isArray(v)) v.forEach((x) => next.append(k, x))
      else if (v) next.set(k, v)
    }
    if (resetPage) next.delete('page')
    setParams(next, { replace: true })
  }

  // Debounced search box (`q`).
  useEffect(() => {
    if (search === qParam) return
    const t = setTimeout(() => update({ q: search || undefined }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [search])

  const query: ReportListParams = {
    status: tab.statuses.length ? tab.statuses : undefined,
    need,
    channel: channels.length ? channels : undefined,
    urgency: urgencies.length ? urgencies : undefined,
    q: qParam || undefined,
    sort,
    page,
    page_size: PAGE_SIZE,
  }
  const reports = useReports(query)
  const stats = useStats()
  const items = useMemo(() => reports.data?.items ?? [], [reports.data])

  // Briefly highlight rows that moved up since the last refetch (§5.4).
  const [snapshot, setSnapshot] = useState<{ items: ReportListItem[]; moved: Set<string> }>({
    items,
    moved: new Set(),
  })
  if (snapshot.items !== items) {
    const before = new Map(snapshot.items.map((r, i) => [r.id, i]))
    const moved = new Set(
      items.filter((r, i) => before.has(r.id) && i < (before.get(r.id) ?? 0)).map((r) => r.id),
    )
    setSnapshot({ items, moved })
  }

  // J/K move the selection, Enter opens (native link behaviour).
  const [selected, setSelected] = useState(0)
  const links = useRef<(HTMLAnchorElement | null)[]>([])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'j' && e.key !== 'k') return
      e.preventDefault()
      setSelected((s) => {
        const n = Math.min(items.length - 1, Math.max(0, s + (e.key === 'j' ? 1 : -1)))
        links.current[n]?.focus()
        return n
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items.length])

  const total = reports.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const byStatus = stats.data?.by_status ?? {}
  const tabCount = (t: (typeof TABS)[number]) =>
    stats.data
      ? t.statuses.length
        ? t.statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0)
        : Object.values(byStatus).reduce((a, b) => a + (b ?? 0), 0)
      : undefined

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Review queue</h1>
          <p className="text-sm text-muted">
            In order of arrival. The AI reads reports; you decide what matters most.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/review/dashboard" className="btn btn-sm">
            <LayoutDashboard size={15} aria-hidden="true" /> Dashboard
          </Link>
        </div>
      </div>

      {/* Status tabs with counts */}
      <nav aria-label="Status" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1 border-b border-border">
          {TABS.map((t) => {
            const active = t.key === tab.key
            const count = tabCount(t)
            return (
              <li key={t.key}>
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => update({ tab: t.key === 'pending' ? undefined : t.key })}
                  className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold ${
                    active
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-text'
                  }`}
                >
                  {t.label}
                  {count !== undefined && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text">
                      {count}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Search, filters, sort */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <label htmlFor="queue-search" className="sr-only">
            Search reports
          </label>
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <input
            id="queue-search"
            type="search"
            dir="auto"
            className="input pl-9"
            placeholder="Search report text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="filter-need" className="text-xs font-semibold text-muted">
            Need
          </label>
          <select
            id="filter-need"
            className="input"
            value={need ?? ''}
            onChange={(e) => update({ need: e.target.value || undefined })}
          >
            <option value="">All needs</option>
            {needKeys.map((n) => (
              <option key={n} value={n}>
                {meta(n).en}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="text-xs font-semibold text-muted">Channel</legend>
          <div className="flex gap-1">
            {CHANNEL_ORDER.map((c) => {
              const Icon = CHANNELS[c].icon
              const active = channels.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ channel: toggle(channels, c) })}
                  className={`btn btn-sm min-h-11 ${active ? 'border-primary bg-surface-2 text-primary' : ''}`}
                >
                  <Icon size={15} aria-hidden="true" /> {CHANNELS[c].label}
                </button>
              )
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-xs font-semibold text-muted">Your urgency</legend>
          <div className="flex gap-1">
            {URGENCY_FILTERS.map((u) => {
              const active = urgencies.includes(u)
              return (
                <button
                  key={u}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ urgency: toggle(urgencies, u) })}
                  className={`btn btn-sm min-h-11 ${active ? 'border-primary bg-surface-2 text-primary' : ''}`}
                >
                  {u === 'unknown' ? 'Not set' : URGENCY_LABEL[u]}
                </button>
              )
            })}
          </div>
        </fieldset>
        <div>
          <label htmlFor="sort" className="text-xs font-semibold text-muted">
            Order
          </label>
          <select
            id="sort"
            className="input"
            value={sort}
            onChange={(e) =>
              update({ sort: e.target.value === 'newest' ? undefined : e.target.value })
            }
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>

      <section aria-label="Reports" className="card overflow-hidden">
        <div className="hidden grid-cols-[8.5rem_7rem_minmax(0,1fr)_11rem_6.5rem_6rem] gap-x-4 border-b border-border bg-surface-2 px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase lg:grid">
          <span>Received</span>
          <span>Channel</span>
          <span>Report</span>
          <span>Needs</span>
          <span>Place</span>
          <span className="text-right">Status</span>
        </div>

        {reports.isPending ? (
          <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading reports">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : reports.isError ? (
          <ErrorState
            error={reports.error}
            onRetry={() => reports.refetch()}
            title="Couldn't load the queue."
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={
              tab.key === 'pending' && !qParam && !need && !channels.length && !urgencies.length
                ? 'No reports waiting.'
                : 'No reports match these filters.'
            }
          >
            {tab.key === 'pending'
              ? 'New submissions will appear here.'
              : 'Try another tab or clear the filters.'}
          </EmptyState>
        ) : (
          <ol aria-label={`${tab.label} reports, ${sort} first`}>
            {items.map((item, i) => (
              <Row
                key={item.id}
                item={item}
                selected={i === selected}
                moved={snapshot.moved.has(item.id)}
                linkRef={(el) => {
                  links.current[i] = el
                }}
                onSelect={() => setSelected(i)}
              />
            ))}
          </ol>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted">
          {total} report{total === 1 ? '' : 's'} · Shortcuts: <kbd>J</kbd>/<kbd>K</kbd> move,{' '}
          <kbd>Enter</kbd> opens
        </p>
        {pages > 1 && (
          <nav aria-label="Pagination" className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-sm"
              disabled={page <= 1}
              onClick={() => update({ page: String(page - 1) }, false)}
            >
              <ChevronLeft size={15} aria-hidden="true" /> Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={page >= pages}
              onClick={() => update({ page: String(page + 1) }, false)}
            >
              Next <ChevronRight size={15} aria-hidden="true" />
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
