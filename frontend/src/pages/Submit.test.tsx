import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, renderRoutes, stubFetch } from '../test-utils'
import { Submit } from './Submit'
import { SubmitDone } from './SubmitDone'

const routes = [
  { path: '/submit', element: <Submit /> },
  { path: '/submit/done/:reference', element: <SubmitDone /> },
]

const health = () =>
  json({ status: 'ok', model: 'fake-heuristic', model_available: true, demo_mode: true })

let api: ReturnType<typeof stubFetch>

beforeEach(() => {
  api = stubFetch({
    'GET /api/health': health,
    'GET /api/helplines': () => json({ items: [] }),
    'GET /api/places/suggest': () =>
      json({
        provider: 'osm',
        items: [{ name: 'Lalkurti', label: 'Lalkurti, Rawalpindi', lat: 33.59, lng: 73.05 }],
      }),
    'POST /api/reports': () =>
      json({ id: 'r1', reference: 'RL-TEST', status: 'pending_review' }, 201),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
})

const textBox = () => screen.getByLabelText('What is happening and what help is needed?')
const submitButton = () => screen.getByRole('button', { name: /Submit report/ })

describe('Submit page', () => {
  it('keeps Submit disabled until the description is long enough', async () => {
    renderRoutes(routes, '/submit')
    expect(submitButton().hasAttribute('disabled')).toBe(true)
    fireEvent.change(textBox(), { target: { value: 'short' } })
    fireEvent.blur(textBox())
    expect(screen.getByText('Write at least 10 characters.')).toBeTruthy()
    fireEvent.change(textBox(), { target: { value: 'Pani aa gaya hai, dawai chahiye' } })
    expect(submitButton().hasAttribute('disabled')).toBe(false)
    expect(screen.getByText('31 / 2,000')).toBeTruthy()
  })

  it('rejects unsupported and oversized photos before upload', () => {
    renderRoutes(routes, '/submit')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] },
    })
    expect(screen.getByText('Use a JPG, PNG or WebP photo.')).toBeTruthy()
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [big] } })
    expect(screen.getByText('Photo must be 5 MB or smaller.')).toBeTruthy()
  })

  it('accepts a valid photo, shows it, and lets the user remove it', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    renderRoutes(routes, '/submit')
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [new File(['img'], 'flood.png', { type: 'image/png' })] },
    })
    expect(await screen.findByAltText('Selected photo preview')).toBeTruthy()
    expect(screen.getByText('flood.png')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }))
    expect(screen.queryByAltText('Selected photo preview')).toBeNull()
  })

  it('selects a place suggestion with coordinates, then clears it', async () => {
    renderRoutes(routes, '/submit')
    const place = screen.getByLabelText(/Where\?/)
    fireEvent.focus(place)
    fireEvent.change(place, { target: { value: 'Lalk' } })
    const option = await screen.findByRole('option', { name: /Lalkurti/ }, { timeout: 3000 })
    fireEvent.mouseDown(option)
    expect((place as HTMLInputElement).value).toBe('Lalkurti, Rawalpindi')
    expect(screen.getByText('Pin set')).toBeTruthy()
    expect(screen.getByText('33.5900, 73.0500')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear location' }))
    expect((place as HTMLInputElement).value).toBe('')
    expect(screen.getByText('No map pin')).toBeTruthy()
  })

  it('shows "no matching places" when the search finds nothing', async () => {
    api = stubFetch({
      'GET /api/health': health,
      'GET /api/helplines': () => json({ items: [] }),
      'GET /api/places/suggest': () => json({ provider: 'osm', items: [] }),
    })
    renderRoutes(routes, '/submit')
    const place = screen.getByLabelText(/Where\?/)
    fireEvent.focus(place)
    fireEvent.change(place, { target: { value: 'Nowhere town' } })
    expect(await screen.findByText(/No matching places/, {}, { timeout: 3000 })).toBeTruthy()
  })

  it('submits the real form fields and opens the confirmation page', async () => {
    renderRoutes(routes, '/submit')
    await waitFor(() => expect(screen.getByText(/Test\/demo report/)).toBeTruthy())
    fireEvent.change(textBox(), { target: { value: 'Pani aa gaya hai, dawai chahiye' } })
    fireEvent.click(submitButton())
    expect(await screen.findByText('Report received')).toBeTruthy()
    expect(screen.getByText('RL-TEST')).toBeTruthy()

    const post = api.calls.find((c) => c.method === 'POST' && c.path === '/api/reports')!
    const body = post.init.body as FormData
    expect(body.get('text')).toBe('Pani aa gaya hai, dawai chahiye')
    expect(body.get('is_synthetic')).toBe('true')
    expect(body.get('lat')).toBeNull()
  })

  it('shows server validation errors next to the right field', async () => {
    api = stubFetch({
      'GET /api/health': health,
      'GET /api/helplines': () => json({ items: [] }),
      'POST /api/reports': () =>
        json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Some fields are missing or invalid.',
              details: {
                fields: [{ field: 'place_text', message: 'Use 200 characters or fewer.' }],
              },
            },
          },
          400,
        ),
    })
    renderRoutes(routes, '/submit')
    fireEvent.change(textBox(), { target: { value: 'Pani aa gaya hai, dawai chahiye' } })
    fireEvent.click(submitButton())
    expect(await screen.findByText('Use 200 characters or fewer.')).toBeTruthy()
    expect(screen.queryByText('Report received')).toBeNull()
  })

  it('shows a clear message when too many reports are sent', async () => {
    api = stubFetch({
      'GET /api/health': health,
      'GET /api/helplines': () => json({ items: [] }),
      'POST /api/reports': () =>
        json({ error: { code: 'RATE_LIMITED', message: 'Slow down', details: {} } }, 429),
    })
    renderRoutes(routes, '/submit')
    fireEvent.change(textBox(), { target: { value: 'Pani aa gaya hai, dawai chahiye' } })
    fireEvent.click(submitButton())
    expect(await screen.findByText(/Too many reports from this connection/)).toBeTruthy()
  })

  it('puts recognised speech into the editable text without submitting', async () => {
    let rec: { onresult: ((e: unknown) => void) | null; onend: (() => void) | null } | null = null
    ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = class {
      lang = ''
      continuous = false
      interimResults = false
      onresult: ((e: unknown) => void) | null = null
      onerror = null
      onend: (() => void) | null = null
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- capture the instance for the test
        rec = this
      }
      start() {}
      stop() {
        this.onend?.()
      }
      abort() {}
    }
    renderRoutes(routes, '/submit')
    fireEvent.change(textBox(), { target: { value: 'Buner mein' } })
    // No offline model in this test (manifest 404s), so the browser speech path is used.
    fireEvent.click(await screen.findByRole('button', { name: /Speak instead/ }))
    act(() =>
      rec!.onresult?.({
        resultIndex: 0,
        results: Object.assign(
          [Object.assign([{ transcript: 'pani aa gaya hai' }], { isFinal: true })],
          {
            length: 1,
          },
        ),
      }),
    )
    expect((textBox() as HTMLTextAreaElement).value).toBe('Buner mein pani aa gaya hai')
    fireEvent.change(textBox(), { target: { value: 'Buner mein pani aa gaya hai, edited' } })
    expect((textBox() as HTMLTextAreaElement).value).toBe('Buner mein pani aa gaya hai, edited')
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false)
  })
})
