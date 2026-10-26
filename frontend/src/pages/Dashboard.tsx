import { AlertTriangle, ArrowRight, Gauge, Map as MapIcon } from 'lucide-react'
import { Link } from 'react-router'
import { useNeeds, usePublicStats, useStats } from '../api/hooks'
import type { ReportStatus, Urgency } from '../api/types'
import { BarList } from '../components/BarList'
import { NeedChip } from '../components/badges'
import { CategoryManager } from '../components/CategoryManager'
import { HelplineManager } from '../components/HelplineManager'
import { SmsGatewayPanel } from '../components/SmsGatewayPanel'
import { ErrorState, Skeleton } from '../components/ui'
import { CHANNEL_ORDER, CHANNELS, STATUS, URGENCY_LABEL } from '../lib/meta'

const KPI_STATUSES: ReportStatus[] = ['pending_review', 'flagged', 'approved', 'rejected']

const URGENCY_TILES: Urgency[] = ['high', 'medium', 'low', 'unknown']

function Tile({
  label,
  value,
  icon,
  to,
}: {
  label: string
  value: number
  icon: React.ReactNode
  to?: string
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-sm font-medium text-muted">
        {icon}
        {label}
      </span>
      <span className="text-3xl font-bold tabular-nums">{value}</span>
    </>
  )
  const cls = 'card flex flex-col gap-1 p-4'
  return to ? (
    <Link to={to} className={`${cls} hover:bg-surface-2`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

const TAB_FOR: Partial<Record<ReportStatus, string>> = {
  flagged: 'flagged',
  approved: 'approved',
  rejected: 'rejected',
}

export function Dashboard() {
  const stats = useStats()
  const pub = usePublicStats()
  const needs = useNeeds()

  if (stats.isError)
    return (
      <ErrorState
        error={stats.error}
        onRetry={() => stats.refetch()}
        title="Couldn't load the dashboard."
      />
    )

  const s = stats.data
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/review" className="btn btn-sm">
            Review queue <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <Link to="/" className="btn btn-sm btn-primary">
            <MapIcon size={14} aria-hidden="true" /> Open public map
          </Link>
        </div>
      </div>

      <section aria-labelledby="kpi-h">
        <h2 id="kpi-h" className="eyebrow mb-2">
          Reports by status
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {!s ? (
            Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)
          ) : (
            <>
              {KPI_STATUSES.map((st) => {
                const m = STATUS[st]
                const Icon = m.icon
                return (
                  <Tile
                    key={st}
                    label={m.label}
                    value={s.by_status[st] ?? 0}
                    icon={<Icon size={16} aria-hidden="true" />}
                    to={`/review${TAB_FOR[st] ? `?tab=${TAB_FOR[st]}` : ''}`}
                  />
                )
              })}
              <Tile
                label="Extraction failures"
                value={s.by_extraction_status.failed ?? 0}
                icon={<AlertTriangle size={16} aria-hidden="true" />}
              />
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="urg-h">
        <h2 id="urg-h" className="eyebrow mb-2">
          Urgency set by reviewers
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {URGENCY_TILES.map((u) =>
            s ? (
              <Tile
                key={u}
                label={u === 'unknown' ? 'Not set yet' : URGENCY_LABEL[u]}
                value={s.by_urgency[u] ?? 0}
                icon={<Gauge size={16} aria-hidden="true" />}
                to={`/review?tab=all&urgency=${u}`}
              />
            ) : (
              <Skeleton key={u} className="h-24" />
            ),
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="channel-h" className="card p-5">
          <h2 id="channel-h" className="mb-4 font-semibold">
            Reports by channel
          </h2>
          {s ? (
            <BarList
              label="Reports by channel"
              items={CHANNEL_ORDER.map((c) => {
                const Icon = CHANNELS[c].icon
                return {
                  key: c,
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Icon size={15} aria-hidden="true" className="text-muted" />{' '}
                      {CHANNELS[c].label}
                    </span>
                  ),
                  value: s.by_channel[c] ?? 0,
                }
              })}
            />
          ) : (
            <Skeleton className="h-24" />
          )}
        </section>

        <section aria-labelledby="need-h" className="card p-5">
          <h2 id="need-h" className="mb-4 font-semibold">
            Approved reports by need
          </h2>
          {pub.isError ? (
            <ErrorState error={pub.error} onRetry={() => pub.refetch()} />
          ) : pub.data ? (
            <BarList
              label="Approved reports by need"
              items={needs.order.map((n) => ({
                key: n,
                label: <NeedChip need={n} />,
                value: pub.data.by_need[n] ?? 0,
              }))}
            />
          ) : (
            <Skeleton className="h-40" />
          )}
        </section>
      </div>

      <SmsGatewayPanel />
      <HelplineManager />
      <CategoryManager />
    </div>
  )
}
