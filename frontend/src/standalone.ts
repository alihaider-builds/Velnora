// Standalone demo: the whole app in one HTML file, opened straight from disk (file://).
// No server and no service worker: the mock backend's handlers answer /api requests in the page
// itself, and MapLibre's worker is loaded from a blob. Built with `npm run build:standalone`.
import * as maplibregl from 'maplibre-gl'
import workerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw'
import { getResponse } from 'msw'
import { categoryHandlers, handlers, persistDb } from './mocks/handlers'

const DEMO_ORIGIN = 'http://relieflens.demo'

const notAvailable = () =>
  new Response(
    JSON.stringify({
      error: { code: 'NOT_FOUND', message: 'Not available in the offline demo.', details: {} },
    }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  )

export function startStandalone() {
  maplibregl.setWorkerUrl(
    URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })),
  )

  const all = [...categoryHandlers, ...handlers]
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input)
    const url = new URL(raw, document.baseURI)
    // From a file the path looks like /C:/api/...; anything under /api/ goes to the mock backend,
    // rewritten onto one fixed origin so matching is the same from disk or from a web server.
    const at = url.pathname.indexOf('/api/')
    if (at === -1) return realFetch(input, init)
    const target = `${DEMO_ORIGIN}${url.pathname.slice(at)}${url.search}`
    const request = new Request(target, input instanceof Request ? input : init)
    const res = await getResponse(all, request, { baseUrl: `${DEMO_ORIGIN}/` })
    if (!res) return notAvailable()
    persistDb()
    return res
  }
}
