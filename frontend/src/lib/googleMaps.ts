import type { Map as MLMap, StyleSpecification } from 'maplibre-gl'

/**
 * Google Maps basemap through the Map Tiles API (2D roadmap tiles), drawn by MapLibre so every
 * map feature (clusters, popups, draggable pins) keeps working. Used only when
 * VITE_GOOGLE_MAPS_API_KEY is set; otherwise the key-free OpenStreetMap basemap is used.
 *
 * Policy (developers.google.com/maps/documentation/tile/policies): show the Google Maps logo
 * (or the words "Google Maps" where space is limited) and the copyright string from the
 * viewport API, and never cover them. Tiles must not be cached or pre-fetched by us.
 * Use a browser key restricted to your site's HTTP referrers.
 */
export const GOOGLE_MAPS_KEY: string = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
const API = 'https://tile.googleapis.com'

let sessionPromise: Promise<string> | null = null

/** One tile session per page load (sessions last about two weeks). */
export function googleSession(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = fetch(`${API}/v1/createSession?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'roadmap', language: 'en-US', region: 'PK' }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Map Tiles session failed (${res.status})`)
        return ((await res.json()) as { session: string }).session
      })
      .catch((err) => {
        sessionPromise = null
        throw err
      })
  }
  return sessionPromise
}

export function googleStyle(session: string): StyleSpecification {
  const key = encodeURIComponent(GOOGLE_MAPS_KEY)
  return {
    version: 8,
    // Fonts for cluster counts; Google tiles are raster images and carry no glyphs.
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      google: {
        type: 'raster',
        tiles: [`${API}/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${key}`],
        tileSize: 256,
        maxzoom: 22,
      },
    },
    layers: [{ id: 'google-roadmap', type: 'raster', source: 'google' }],
  }
}

/** Adds the required "Google Maps" mark and the live copyright line; returns a cleanup. */
export function attachGoogleAttribution(map: MLMap, session: string): () => void {
  const el = document.createElement('div')
  el.className = 'google-attribution'
  Object.assign(el.style, {
    position: 'absolute',
    left: '6px',
    bottom: '6px',
    zIndex: '2',
    padding: '2px 6px',
    borderRadius: '4px',
    background: 'rgb(255 255 255 / 0.85)',
    color: '#202124',
    font: '11px/1.4 Roboto, Arial, sans-serif',
    pointerEvents: 'none',
  })
  el.innerHTML = '<strong style="font-weight:600">Google Maps</strong> <span></span>'
  map.getContainer().appendChild(el)
  const line = el.querySelector('span') as HTMLSpanElement

  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const b = map.getBounds()
      const q = new URLSearchParams({
        session,
        key: GOOGLE_MAPS_KEY,
        zoom: String(Math.round(map.getZoom())),
        north: String(b.getNorth()),
        south: String(b.getSouth()),
        east: String(b.getEast()),
        west: String(b.getWest()),
      })
      try {
        const res = await fetch(`${API}/tile/v1/viewport?${q}`)
        if (res.ok)
          line.textContent = ((await res.json()) as { copyright?: string }).copyright ?? ''
      } catch {
        /* keep the last copyright line */
      }
    }, 400)
  }
  map.on('moveend', refresh)
  refresh()
  return () => {
    clearTimeout(timer)
    map.off('moveend', refresh)
    el.remove()
  }
}
