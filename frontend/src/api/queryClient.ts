import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { ApiError, isNetworkError } from './client'

// §5.7 — "Can't reach the server — retrying…" after requests fail repeatedly.
const FAILURES_BEFORE_BANNER = 2
let consecutiveFailures = 0
const listeners = new Set<() => void>()

function setFailures(n: number) {
  if (n === consecutiveFailures) return
  consecutiveFailures = n
  listeners.forEach((l) => l())
}

function onError(error: unknown) {
  if (isNetworkError(error)) setFailures(consecutiveFailures + 1)
}

function onSuccess() {
  setFailures(0)
}

export function useServerUnreachable(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => consecutiveFailures >= FAILURES_BEFORE_BANNER,
  )
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError, onSuccess }),
  mutationCache: new MutationCache({ onError, onSuccess }),
  defaultOptions: {
    queries: {
      // Don't retry client errors (401, 404, 409…); retry network failures a few times.
      retry: (count, error) =>
        error instanceof ApiError && error.status < 500 && error.status !== 0 ? false : count < 2,
      refetchOnWindowFocus: false,
    },
  },
})
