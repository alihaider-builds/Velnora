import type { ApiErrorBody } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * True when the server could not be reached: fetch failed (status 0), or a 5xx without the
 * contract's JSON error body (e.g. the Vite proxy answering because the backend is down).
 * A 502 GEOCODER_UNAVAILABLE carries a JSON body, so it is not counted.
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return error.status === 0 || (error.status >= 500 && error.code.startsWith('HTTP_'))
}

type Query = Record<string, string | number | undefined | (string | number)[]>

/** Builds `path?a=1&b=x&b=y`; arrays become repeated keys (§4.4 "repeatable"). */
export function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: { Accept: 'application/json' },
  }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
  }

  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach the server.")
  }

  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as ApiErrorBody | null
    throw new ApiError(
      res.status,
      parsed?.error?.code ?? `HTTP_${res.status}`,
      parsed?.error?.message ?? res.statusText,
      parsed?.error?.details,
    )
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', withQuery(path, query)),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
