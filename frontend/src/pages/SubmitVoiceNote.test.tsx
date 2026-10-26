import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, renderRoutes, stubFetch } from '../test-utils'
import { Submit } from './Submit'
import { SubmitDone } from './SubmitDone'

// Stand-in for the voice box: one click "dictates" text and hands over a 2-second recording.
vi.mock('../components/VoiceInput', () => ({
  VoiceInput: ({
    onText,
    onRecording,
  }: {
    onText: (t: string) => void
    onRecording?: (s: Float32Array) => void
  }) => (
    <button
      type="button"
      onClick={() => {
        onText('Buner mein pani aa gaya hai, dawai chahiye')
        onRecording?.(new Float32Array(16000 * 2))
      }}
    >
      Fake dictation
    </button>
  ),
}))

const routes = [
  { path: '/submit', element: <Submit /> },
  { path: '/submit/done/:reference', element: <SubmitDone /> },
]

let api: ReturnType<typeof stubFetch>
const base = {
  'GET /api/health': () =>
    json({ status: 'ok', model: 'fake', model_available: true, demo_mode: false }),
  'GET /api/helplines': () => json({ items: [] }),
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:voice')
  URL.revokeObjectURL = vi.fn()
  api = stubFetch({
    ...base,
    'POST /api/reports': () =>
      json({ id: 'r1', reference: 'RL-VOICE', status: 'pending_review' }, 201),
  })
})
afterEach(() => vi.unstubAllGlobals())

const sentForm = () =>
  api.calls.find((c) => c.method === 'POST' && c.path === '/api/reports')!.init.body as FormData

describe('Submit page voice note', () => {
  it('attaches the dictation recording as a WAV voice note by default', async () => {
    renderRoutes(routes, '/submit')
    fireEvent.click(screen.getByRole('button', { name: 'Fake dictation' }))
    expect(screen.getByText('Voice recording · 0:02')).toBeTruthy()
    expect(screen.getByLabelText(/Send my voice recording/)).toHaveProperty('checked', true)

    fireEvent.click(screen.getByRole('button', { name: /Submit report/ }))
    await screen.findByText('RL-VOICE')
    const audio = sentForm().get('audio') as File
    expect(audio.name).toBe('voice-note.wav')
    expect(audio.type).toBe('audio/wav')
    expect(audio.size).toBe(44 + 16000 * 2 * 2) // 16 kHz, 16-bit mono, 2 s
    expect(sentForm().get('text')).toBe('Buner mein pani aa gaya hai, dawai chahiye')
  })

  it('does not send the recording when the box is unticked', async () => {
    renderRoutes(routes, '/submit')
    fireEvent.click(screen.getByRole('button', { name: 'Fake dictation' }))
    fireEvent.click(screen.getByLabelText(/Send my voice recording/))
    fireEvent.click(screen.getByRole('button', { name: /Submit report/ }))
    await screen.findByText('RL-VOICE')
    expect(sentForm().get('audio')).toBeNull()
  })

  it('can remove the recording before sending', () => {
    renderRoutes(routes, '/submit')
    fireEvent.click(screen.getByRole('button', { name: 'Fake dictation' }))
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }))
    expect(screen.queryByText(/Voice recording ·/)).toBeNull()
  })

  it('shows audio errors from the server next to the voice note', async () => {
    api = stubFetch({
      ...base,
      'POST /api/reports': () =>
        json(
          {
            error: {
              code: 'AUDIO_TOO_LONG',
              message: 'Recordings must be 5 minutes or shorter.',
              details: {},
            },
          },
          413,
        ),
    })
    renderRoutes(routes, '/submit')
    fireEvent.click(screen.getByRole('button', { name: 'Fake dictation' }))
    fireEvent.click(screen.getByRole('button', { name: /Submit report/ }))
    expect(await screen.findByText('Recordings must be 5 minutes or shorter.')).toBeTruthy()
    expect(screen.queryByText(/Use a JPG/)).toBeNull()
  })
})
