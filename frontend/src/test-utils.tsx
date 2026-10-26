import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { vi } from 'vitest'
import { ToastProvider } from './components/Toast'

/** Renders routes at `path` with a fresh query client (no retries) and toasts. */
export function renderRoutes(routes: RouteObject[], path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...utils, router }
}

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Stubs global fetch with per-path handlers (e.g. 'GET /api/health'). Unknown requests get a
 * 404 so a test never silently depends on an unhandled call.
 */
export function stubFetch(handlers: Record<string, Handler>) {
  const calls: { method: string; path: string; init: RequestInit }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init.method ?? 'GET').toUpperCase()
    calls.push({ method, path: url.pathname, init })
    const handler = handlers[`${method} ${url.pathname}`]
    return handler
      ? handler(url, init)
      : json({ error: { code: 'NOT_FOUND', message: 'nope', details: {} } }, 404)
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}
