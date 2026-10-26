import * as maplibregl from 'maplibre-gl'
import type { Map as MLMap } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { MapPinOff } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { BASEMAP_STYLE, PAKISTAN_CENTER, PAKISTAN_ZOOM } from '../lib/config'
import {
  attachGoogleAttribution,
  GOOGLE_MAPS_KEY,
  googleSession,
  googleStyle,
} from '../lib/googleMaps'

// MapLibre resolves its worker next to its own module, which Vite's dependency pre-bundling
// moves; point it at the worker file explicitly so maps load in dev and production builds.
maplibregl.setWorkerUrl(workerUrl)

// eslint-disable-next-line react-refresh/only-export-components
export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Resolves a CSS custom property to its current value (MapLibre paint can't read CSS vars). */
// eslint-disable-next-line react-refresh/only-export-components
export function cssVar(value: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(value)
  if (!m) return value
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#888'
}

/** Creates a MapLibre map once; `failed` is true when WebGL is unavailable. The basemap is
 * Google Maps when VITE_GOOGLE_MAPS_API_KEY is set (falling back to OpenStreetMap if Google
 * refuses the key), otherwise OpenStreetMap. */
// eslint-disable-next-line react-refresh/only-export-components
export function useMapLibre(
  container: RefObject<HTMLDivElement | null>,
  { center = PAKISTAN_CENTER, zoom = PAKISTAN_ZOOM, compactAttribution = true } = {},
) {
  const [map, setMap] = useState<MLMap | null>(null)
  const [failed, setFailed] = useState(false)
  const initial = useRef({ center, zoom, compactAttribution })

  useEffect(() => {
    const el = container.current
    if (!el) return
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    let instance: MLMap | null = null
    let detach: (() => void) | undefined
    let cancelled = false

    const create = (session: string | null) => {
      if (cancelled) return
      try {
        instance = new maplibregl.Map({
          container: el,
          style: session ? googleStyle(session) : dark ? BASEMAP_STYLE.dark : BASEMAP_STYLE.light,
          center: initial.current.center,
          zoom: initial.current.zoom,
          attributionControl: session ? false : { compact: initial.current.compactAttribution },
          cooperativeGestures: false,
        })
      } catch {
        setFailed(true)
        return
      }
      instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
      if (session) detach = attachGoogleAttribution(instance, session)
      // Expose the map immediately so clicks and markers work before tiles finish loading;
      // code that adds sources/layers waits for the style itself (see whenStyleReady).
      setMap(instance)
    }

    if (GOOGLE_MAPS_KEY) {
      googleSession().then(create, (err) => {
        console.warn('Google Maps unavailable, using OpenStreetMap:', err)
        create(null)
      })
    } else {
      create(null)
    }
    return () => {
      cancelled = true
      detach?.()
      setMap(null)
      instance?.remove()
    }
  }, [container])

  return { map, failed }
}

/** Runs `fn` once the map style is loaded (needed before adding sources or layers). */
// eslint-disable-next-line react-refresh/only-export-components
export function whenStyleReady(map: MLMap, fn: () => void): () => void {
  if (map.isStyleLoaded()) {
    fn()
    return () => {}
  }
  map.once('load', fn)
  return () => {
    map.off('load', fn)
  }
}

export function MapUnavailable() {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 bg-surface-2 p-4 text-center text-sm text-muted">
      <MapPinOff size={22} aria-hidden="true" />
      The map can't be shown in this browser. Use the list instead.
    </div>
  )
}

export interface MapMarker {
  id: string
  lat: number
  lng: number
  kind: 'selected' | 'candidate' | 'submitter'
  label: string
}

function markerElement(kind: MapMarker['kind'], label: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  el.title = label
  const size = kind === 'selected' ? 22 : 14
  const color =
    kind === 'selected'
      ? 'var(--primary)'
      : kind === 'submitter'
        ? 'var(--pending)'
        : 'var(--surface)'
  const border = kind === 'candidate' ? 'var(--primary)' : 'var(--surface)'
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    background: color,
    border: `3px solid ${border}`,
    boxShadow: '0 1px 4px rgb(0 0 0 / .35)',
    cursor: kind === 'selected' ? 'grab' : 'pointer',
  })
  return el
}

/**
 * Marker map used by the location pickers. Clicking the map calls `onPick`; the selected
 * marker can be dragged (`onDrag`). Every action here is also available outside the map.
 */
export function MapView({
  markers,
  onPick,
  onDrag,
  onMarkerClick,
  focus,
  className = 'h-64',
  label,
}: {
  markers: MapMarker[]
  onPick?: (lat: number, lng: number) => void
  onDrag?: (lat: number, lng: number) => void
  onMarkerClick?: (id: string) => void
  focus?: { lat: number; lng: number; zoom?: number } | null
  className?: string
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { map, failed } = useMapLibre(ref, {
    center: focus ? [focus.lng, focus.lat] : PAKISTAN_CENTER,
    zoom: focus ? (focus.zoom ?? 10) : PAKISTAN_ZOOM,
  })
  const handlers = useRef({ onPick, onDrag, onMarkerClick })
  useEffect(() => {
    handlers.current = { onPick, onDrag, onMarkerClick }
  })

  useEffect(() => {
    if (!map) return
    const onClick = (e: maplibregl.MapMouseEvent) =>
      handlers.current.onPick?.(e.lngLat.lat, e.lngLat.lng)
    map.on('click', onClick)
    map.getCanvas().style.cursor = handlers.current.onPick ? 'crosshair' : ''
    return () => {
      map.off('click', onClick)
    }
  }, [map])

  useEffect(() => {
    if (!map) return
    const created = markers.map((m) => {
      const el = markerElement(m.kind, m.label)
      const marker = new maplibregl.Marker({
        element: el,
        draggable: m.kind === 'selected' && !!onDrag,
      })
        .setLngLat([m.lng, m.lat])
        .addTo(map)
      if (m.kind === 'selected') {
        marker.on('dragend', () => {
          const p = marker.getLngLat()
          handlers.current.onDrag?.(p.lat, p.lng)
        })
      } else {
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          handlers.current.onMarkerClick?.(m.id)
        })
      }
      return marker
    })
    return () => created.forEach((m) => m.remove())
  }, [map, markers, onDrag])

  const focusKey = focus ? `${focus.lat},${focus.lng},${focus.zoom ?? ''}` : ''
  useEffect(() => {
    if (!map || !focus) return
    const target = {
      center: [focus.lng, focus.lat] as [number, number],
      zoom: focus.zoom ?? Math.max(map.getZoom(), 10),
    }
    if (prefersReducedMotion()) map.jumpTo(target)
    else map.easeTo({ ...target, duration: 500 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the focus point changes
  }, [map, focusKey])

  if (failed)
    return (
      <div className={`overflow-hidden rounded-lg border border-border ${className}`}>
        <MapUnavailable />
      </div>
    )
  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      className={`overflow-hidden rounded-lg border border-border ${className}`}
    />
  )
}
