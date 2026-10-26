import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildRoutes } from './routes'
import { json, renderRoutes, stubFetch } from './test-utils'

beforeEach(() => {
  stubFetch({
    'GET /api/health': () =>
      json({ status: 'ok', model: 'fake-heuristic', model_available: true, demo_mode: true }),
    'GET /api/helplines': () => json({ items: [] }),
    'GET /api/auth/me': () =>
      json({ error: { code: 'UNAUTHORIZED', message: 'Sign in', details: {} } }, 401),
  })
})
afterEach(() => vi.unstubAllGlobals())

const prodRoutes = () => buildRoutes({ devTools: false })

describe('navigation', () => {
  it('has Map, Submit a report and Review — and no Simulator', async () => {
    renderRoutes(prodRoutes(), '/submit')
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]
    // Demo mode is on, which used to reveal the Simulator link.
    await waitFor(() => expect(screen.getByText(/Demo data/)).toBeTruthy())
    const names = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent?.trim())
    expect(names).toEqual(['Map', 'Submit a report', 'Review'])
    expect(within(nav).queryByText(/Simulator/)).toBeNull()
  })

  it('redirects /simulator to the submit page in production builds', async () => {
    const { router } = renderRoutes(prodRoutes(), '/simulator')
    await waitFor(() => expect(router.state.location.pathname).toBe('/submit'))
    expect(screen.getByRole('heading', { name: 'Submit a report' })).toBeTruthy()
  })

  it('keeps the other routes working', async () => {
    const { router } = renderRoutes(prodRoutes(), '/review/login')
    expect(await screen.findByRole('heading', { name: 'Reviewer sign-in' })).toBeTruthy()
    await router.navigate('/does-not-exist')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
  })
})
