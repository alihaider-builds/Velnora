import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import { ChevronUp, MapPin, Send, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useNeeds, usePublicReports, usePublicStats } from '../api/hooks'
import type { NeedCategory, PublicReport } from '../api/types'
import { BarList } from '../components/BarList'
import { NeedChip } from '../components/badges'
import {
  cssVar,
  MapUnavailable,
  prefersReducedMotion,
  useMapLibre,
  whenStyleReady,
} from '../components/MapView'
import { EmptyState, ErrorState, Skeleton } from '../components/ui'
import { relativeTime } from '../lib/format'
import { NEED_ORDER, NEEDS, type NeedMeta } from '../lib/meta'
import { DownloadApproved } from '../components/DownloadApproved'

const SOURCE = 'public-reports'

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** Popup: need chips, area, approval time, demo tag. Never text, quantities or images (§5.1). */
function popupHtml(r: PublicReport, meta: (key: NeedCategory) => NeedMeta): string {
  const chips = r.needs
    .map((n) => {
      const m = meta(n)
      return `<span style="display:inline-flex;align-items:center;gap:4px;border:1px solid ${cssVar(m.color)};border-radius:999px;padding:1px 8px;font-size:12px;font-weight:600;margin:0 4px 4px 0"><span style="width:8px;height:8px;border-radius:50%;background:${cssVar(m.color)}"></span>${escapeHtml(m.en)}</span>`
    })
    .join('')
  const demo = r.is_synthetic
    ? `<span style="display:inline-block;margin-top:6px;font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;background:${cssVar('var(--banner-bg)')};color:${cssVar('var(--banner-text)')}">Demo data</span>`
    : ''
  return `<div style="font-family:Inter,system-ui,sans-serif;max-width:240px">
    <div>${chips}</div>
    <div style="font-weight:600;font-size:14px">${escapeHtml(r.area_label)}</div>
    <div style="font-size:12px;color:${cssVar('var(--text-muted)')}">Approved ${escapeHtml(relativeTime(r.approved_at))}</div>
    ${demo}</div>`
}

function ReportsMap({
  reports,
  focus,
}: {
  reports: PublicReport[]
  focus: { report: PublicReport; seq: number } | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { map, failed } = useMapLibre(ref, { compactAttribution: false })
  const { meta } = useNeeds()
  const metaRef = useRef(meta)
  useEffect(() => {
    metaRef.current = meta
  })
  const popup = useRef<maplibregl.Popup | null>(null)
  const byId = useRef(new Map<string, PublicReport>())

  const [ready, setReady] = useState(false)

  // Layers: clustered circles with counts; single pins coloured by the first need.
  useEffect(() => {
    if (!map) return
    return whenStyleReady(map, () => {
      const needColor: maplibregl.ExpressionSpecification = [
        'match',
        ['get', 'need'],
        ...NEED_ORDER.flatMap((n) => [n, cssVar(NEEDS[n].color)]),
        cssVar('var(--primary)'),
      ] as unknown as maplibregl.ExpressionSpecification
      map.addSource(SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterRadius: 40,
        clusterMaxZoom: 11,
      })
      // Soft halo under clusters and pins so they stand out on a busy basemap (not clickable).
      map.addLayer({
        id: 'clusters-halo',
        type: 'circle',
        source: SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': cssVar('var(--primary)'),
          'circle-radius': ['step', ['get', 'point_count'], 26, 5, 31, 10, 36],
          'circle-opacity': 0.22,
        },
      })
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': cssVar('var(--primary)'),
          'circle-radius': ['step', ['get', 'point_count'], 17, 5, 21, 10, 25],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: SOURCE,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Bold'],
          'text-size': 13,
        },
        paint: { 'text-color': '#ffffff' },
      })
      map.addLayer({
        id: 'pins-halo',
        type: 'circle',
        source: SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': needColor,
          'circle-radius': 18,
          'circle-opacity': 0.25,
          'circle-blur': 0.3,
        },
      })
      map.addLayer({
        id: 'pins',
        type: 'circle',
        source: SOURCE,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': needColor,
          'circle-radius': 10,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      })

      const onPin = (e: maplibregl.MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined
        const r = id ? byId.current.get(id) : undefined
        if (!r) return
        popup.current?.remove()
        popup.current = new maplibregl.Popup({ offset: 12, maxWidth: '260px' })
          .setLngLat([r.lng, r.lat])
          .setHTML(popupHtml(r, metaRef.current))
          .addTo(map)
      }
      const onCluster = async (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (!f) return
        const zoom = await (map.getSource(SOURCE) as GeoJSONSource).getClusterExpansionZoom(
          f.properties.cluster_id,
        )
        const center = (f.geometry as unknown as { coordinates: [number, number] }).coordinates
        if (prefersReducedMotion()) map.jumpTo({ center, zoom })
        else map.easeTo({ center, zoom })
      }
      const pointer = () => (map.getCanvas().style.cursor = 'pointer')
      const reset = () => (map.getCanvas().style.cursor = '')
      map.on('click', 'pins', onPin)
      map.on('click', 'clusters', onCluster)
      for (const l of ['pins', 'clusters']) {
        map.on('mouseenter', l, pointer)
        map.on('mouseleave', l, reset)
      }
      setReady(true)
    })
  }, [map])

  useEffect(() => {
    byId.current = new Map(reports.map((r) => [r.id, r]))
    if (!ready) return
    const src = map?.getSource(SOURCE) as GeoJSONSource | undefined
    src?.setData({
      type: 'FeatureCollection',
      features: reports.map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: { id: r.id, need: r.needs[0] ?? 'other' },
      })),
    })
  }, [map, reports, ready])

  // Frame the approved pins the first time they arrive, so the view starts on the reports.
  const [framed, setFramed] = useState(false)
  useEffect(() => {
    if (!map || !ready || framed || reports.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    reports.forEach((r) => bounds.extend([r.lng, r.lat]))
    // The container may have changed size since the map was created; measure before fitting.
    map.resize()
    map.fitBounds(bounds, { padding: 60, maxZoom: 9, animate: false })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time flag after framing
    setFramed(true)
  }, [map, ready, framed, reports])

  useEffect(() => {
    if (!map || !focus) return
    const r = focus.report
    const target = { center: [r.lng, r.lat] as [number, number], zoom: 12 }
    if (prefersReducedMotion()) map.jumpTo(target)
    else map.easeTo({ ...target, duration: 600 })
    popup.current?.remove()
    popup.current = new maplibregl.Popup({ offset: 12, maxWidth: '260px' })
      .setLngLat([r.lng, r.lat])
      .setHTML(popupHtml(r, metaRef.current))
      .addTo(map)
  }, [map, focus])

  if (failed) return <MapUnavailable />
  return (
    <div ref={ref} role="region" aria-label="Map of verified needs" className="h-full w-full" />
  )
}

export function PublicMap() {
  const [needs, setNeeds] = useState<NeedCategory[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [focus, setFocus] = useState<{ report: PublicReport; seq: number } | null>(null)
  const { order: needKeys, meta: needInfo } = useNeeds()
  const reports = usePublicReports(needs)
  const stats = usePublicStats()
  const items = useMemo(() => reports.data?.items ?? [], [reports.data])
  const filtered = needs.length > 0

  // Unfiltered: counts from /public/stats. Filtered: only the selected needs, counted from the
  // reports on the map, so the bars match the filter (US-17).
  const counts = useMemo(() => {
    if (!filtered) return stats.data?.by_need ?? {}
    const out: Partial<Record<NeedCategory, number>> = {}
    items.forEach((r) =>
      r.needs.forEach((n) => {
        if (needs.includes(n)) out[n] = (out[n] ?? 0) + 1
      }),
    )
    return out
  }, [filtered, needs, stats.data, items])
  const barNeeds = filtered
    ? needKeys.filter((n) => needs.includes(n))
    : needKeys.filter((n) => (counts[n] ?? 0) > 0)
  const barSum = barNeeds.reduce((sum, n) => sum + (counts[n] ?? 0), 0)

  const areas = useMemo(() => {
    if (!filtered) return stats.data?.by_area ?? []
    const m = new Map<string, number>()
    items.forEach((r) => m.set(r.area_label, (m.get(r.area_label) ?? 0) + 1))
    return [...m]
      .map(([area_label, count]) => ({ area_label, count }))
      .sort((a, b) => b.count - a.count)
  }, [filtered, stats.data, items])

  const total = filtered ? items.length : (stats.data?.total_approved ?? items.length)
  const loading = reports.isPending || stats.isPending
  const error = reports.error ?? stats.error

  const panel = (p: string) => (
    <div className="flex flex-col gap-5">
      <div className="hero-card rounded-xl border border-border p-4">
        <p className="eyebrow flex items-center gap-1.5">
          <ShieldCheck size={14} aria-hidden="true" className="text-verified-ink" />
          Reviewer-approved
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Verified needs</h1>
        {loading ? (
          <Skeleton className="mt-2 h-6 w-40" />
        ) : (
          <p className="text-muted">
            <span className="text-3xl font-bold text-text tabular-nums">{total}</span> approved
            report
            {total === 1 ? '' : 's'}
            {filtered && (
              <>
                {' '}
                with {needs.length > 1 ? 'any selected need' : 'this need'}
                {stats.data && (
                  <span className="block text-sm">of {stats.data.total_approved} in total</span>
                )}
              </>
            )}
          </p>
        )}
      </div>

      <fieldset>
        <legend className="eyebrow mb-2">Filter by need</legend>
        <div className="flex flex-wrap gap-1.5">
          {needKeys.map((n) => {
            const on = needs.includes(n)
            const m = needInfo(n)
            const Icon = m.icon
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                onClick={() => setNeeds((cur) => (on ? cur.filter((x) => x !== n) : [...cur, n]))}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-medium ${
                  on
                    ? 'border-primary bg-surface-2 text-primary'
                    : 'border-border bg-surface hover:bg-surface-2'
                }`}
              >
                <Icon size={14} aria-hidden="true" style={{ color: m.color }} />
                {m.en}
              </button>
            )
          })}
          {filtered && (
            <button
              type="button"
              className="link inline-flex min-h-11 items-center px-2 text-sm"
              onClick={() => setNeeds([])}
            >
              Clear
            </button>
          )}
        </div>
      </fieldset>

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void reports.refetch()
            void stats.refetch()
          }}
          title="Couldn't load the map data."
        />
      ) : loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-24" />
        </div>
      ) : total === 0 ? (
        <EmptyState
          title={filtered ? 'No verified reports for this need.' : 'No verified reports yet.'}
          icon={<MapPin size={28} aria-hidden="true" />}
        >
          <Link to="/submit" className="link inline-flex min-h-11 items-center gap-1">
            <Send size={14} aria-hidden="true" /> Submit a report
          </Link>
        </EmptyState>
      ) : (
        <>
          <section aria-labelledby={`${p}-by-need`}>
            <h2 id={`${p}-by-need`} className="eyebrow mb-2">
              Reports by need
            </h2>
            <BarList
              label="Approved reports by need"
              items={barNeeds.map((n) => ({
                key: n,
                label: <NeedChip need={n} bilingual />,
                value: counts[n] ?? 0,
                color: needInfo(n).color,
              }))}
            />
            {barSum > total && (
              <p className="mt-2 text-xs text-muted">
                A report can list more than one need, so these counts add up to more than {total}.
              </p>
            )}
          </section>

          <section aria-labelledby={`${p}-top-areas`}>
            <h2 id={`${p}-top-areas`} className="eyebrow mb-2">
              Top areas
            </h2>
            <ol className="flex flex-col">
              {areas.slice(0, 6).map((a) => {
                const first = items.find((r) => r.area_label === a.area_label)
                return (
                  <li key={a.area_label}>
                    <button
                      type="button"
                      disabled={!first}
                      onClick={() => {
                        if (!first) return
                        setFocus((f) => ({ report: first, seq: (f?.seq ?? 0) + 1 }))
                        setSheetOpen(false)
                      }}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-sm hover:bg-surface-2"
                    >
                      <span className="flex items-center gap-2">
                        <MapPin size={14} aria-hidden="true" className="text-muted" />
                        {a.area_label}
                      </span>
                      <span className="font-semibold tabular-nums">{a.count}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        </>
      )}

      <footer className="flex flex-col gap-2 border-t border-border pt-4 text-xs text-muted">
        <p className="flex gap-2">
          <ShieldCheck size={15} aria-hidden="true" className="shrink-0 text-verified" />
          Only reviewer-approved reports appear. Locations are approximate (about 1 km).
        </p>
        <div>
          <DownloadApproved scope="public" />
        </div>
        <p>
          Map:{' '}
          <a className="link" href="https://openfreemap.org" target="_blank" rel="noreferrer">
            OpenFreeMap
          </a>{' '}
          ©{' '}
          <a className="link" href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">
            OpenMapTiles
          </a>{' '}
          · Data ©{' '}
          <a
            className="link"
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap contributors
          </a>
        </p>
      </footer>
    </div>
  )

  return (
    // md+: fill exactly the space under the header (h-0 + flex-1), so the side panel scrolls on
    // its own and the map never extends below the screen.
    <div className="relative flex flex-1 flex-col md:h-0 md:min-h-[480px] md:flex-row">
      {/* Desktop side panel (~30%) */}
      <aside className="relative hidden w-[30%] max-w-md min-w-80 border-r border-border bg-surface md:block">
        {/* Absolutely positioned so the panel's length never stretches the page past the screen. */}
        <div className="absolute inset-0 overflow-y-auto p-5">{panel('side')}</div>
      </aside>

      {/* Map (~70%; full screen on mobile) */}
      <div className="relative min-h-[calc(100dvh-7.5rem)] flex-1 md:min-h-0">
        <div className="absolute inset-0">
          <ReportsMap reports={items} focus={focus} />
        </div>
      </div>

      {/* Mobile bottom sheet */}
      <section
        aria-label="Verified needs summary"
        className={`fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-border bg-surface shadow-pop md:hidden ${
          sheetOpen ? 'max-h-[75dvh]' : ''
        }`}
      >
        <button
          type="button"
          className="flex min-h-11 w-full flex-col items-center gap-1 pt-2"
          aria-expanded={sheetOpen}
          aria-controls="sheet-body"
          onClick={() => setSheetOpen((o) => !o)}
        >
          <span className="h-1.5 w-10 rounded-full bg-border" aria-hidden="true" />
          <span className="flex items-center gap-1 text-sm font-semibold">
            {loading ? 'Loading…' : `${total} verified report${total === 1 ? '' : 's'}`}
            <ChevronUp size={16} aria-hidden="true" className={sheetOpen ? 'rotate-180' : ''} />
          </span>
        </button>
        {sheetOpen && (
          <div id="sheet-body" className="overflow-y-auto px-4 pb-6">
            {panel('sheet')}
          </div>
        )}
      </section>
    </div>
  )
}
