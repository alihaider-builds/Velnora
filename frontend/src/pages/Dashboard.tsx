import { AlertTriangle, ArrowRight, Gauge, Map as MapIcon } from 'lucide-react'
import { Link } from 'react-router'
import { useNeeds, usePublicStats, useStats } from '../api/hooks'
import type { Channel, ReportStatus, Urgency } from '../api/types'
import { BarList } from '../components/BarList'
import { NeedChip } from '../components/badges'
import { CategoryManager } from '../components/CategoryManager'
import { ErrorState, Skeleton } from '../components/ui'
import { CHANNEL_ORDER, CHANNELS, STATUS, URGENCY_LABEL } from '../lib/meta'

const KPI_STATUSES: ReportStatus[] = ['pending_review', 'flagged', 'approved', 'rejected']

// Channel bars reuse hues of the validated categorical sequence (tokens.css).
const CHANNEL_COLOR: Record<Channel, string> = {
  web: 'var(--need-clean_water)',
  sms: 'var(--need-evacuation)',
  whatsapp: 'var(--need-shelter)',
  call: 'var(--need-food)',
}

const URGENCY_TILES: Urgency[] = ['high', 'medium', 'low', 'unknown']

function Tile({
  label,
  value,
  icon,
  color,
  to,
}: {
  label: string
  value: number
  icon: React.ReactNode
  color: string
  to?: string
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-sm font-medium text-muted">
        <span style={{ color }}>{icon}</span>
        {label}
      </span>
      <span className="text-3xl font-bold tabular-nums">{value}</span>
    </>
  )
  const cls = 'card flex flex-col gap-1 p-4'
  return to ? (
    <Link
      to={to}
      className={`${cls} hover:bg-surface-2`}
      style={{ borderTop: `3px solid ${color}` }}
    >
      {body}
    </Link>
  ) : (
    <div className={cls} style={{ borderTop: `3px solid ${color}` }}>
      {body}
    </div>
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
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted">Counts across all reports. Updates every 30 seconds.</p>
        </div>
        <div className="flex gap-2">
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
                    color={m.color}
                    icon={<Icon size={16} aria-hidden="true" />}
                    to={`/review${TAB_FOR[st] ? `?tab=${TAB_FOR[st]}` : ''}`}
                  />
                )
              })}
              <Tile
                label="Extraction failures"
                value={s.by_extraction_status.failed ?? 0}
                color="var(--rejected)"
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
                color="var(--primary)"
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
                  color: CHANNEL_COLOR[c],
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
                color: needs.meta(n).color,
              }))}
            />
          ) : (
            <Skeleton className="h-40" />
          )}
        </section>
      </div>

      <CategoryManager />

      <section aria-labelledby="areas-h" className="card overflow-hidden">
        <h2 id="areas-h" className="px-5 pt-5 pb-3 font-semibold">
          Top areas by approved reports
        </h2>
        {pub.data ? (
          pub.data.by_area.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted">No approved reports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" className="px-5 py-2 font-semibold">
                      Area
                    </th>
                    <th scope="col" className="px-5 py-2 text-right font-semibold">
                      Approved
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pub.data.by_area.slice(0, 10).map((a) => (
                    <tr key={a.area_label} className="border-t border-border">
                      <td className="px-5 py-2.5">{a.area_label}</td>
                      <td className="px-5 py-2.5 text-right font-semibold tabular-nums">
                        {a.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <Skeleton className="mx-5 mb-5 h-24" />
        )}
      </section>
    </div>
  )
}
