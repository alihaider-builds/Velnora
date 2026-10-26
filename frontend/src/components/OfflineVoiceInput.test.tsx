import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OfflineVoiceInput } from './OfflineVoiceInput'

vi.mock('../lib/offlineSpeech', () => ({
  preloadOfflineVoice: vi.fn(),
  transcribeOffline: vi.fn(async () => 'Buner mein pani aa gaya hai'),
}))
vi.mock('../lib/wav', () => ({
  toMono16k: vi.fn(async () => ({ samples: new Float32Array(16000 * 3).fill(0.01), seconds: 3 })),
}))

import { preloadOfflineVoice, transcribeOffline } from '../lib/offlineSpeech'

const MODELS = { urdu: 'onnx-community/whisper-small', english: 'onnx-community/whisper-base' }

class FakeMediaRecorder {
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

const track = { stop: vi.fn() }
let getUserMedia: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function recordAndStop() {
  fireEvent.click(screen.getByRole('button', { name: /Speak instead/ }))
  await screen.findByRole('button', { name: /Stop/ })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
  })
}

describe('OfflineVoiceInput', () => {
  it('records, converts Urdu with the Urdu model, and hands over text and the recording', async () => {
    const onText = vi.fn()
    const onRecording = vi.fn()
    render(<OfflineVoiceInput models={MODELS} onText={onText} onRecording={onRecording} />)
    expect(screen.getByText('Works offline')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Speak instead/ }))
    await screen.findByRole('button', { name: /Stop/ })
    expect(preloadOfflineVoice).toHaveBeenCalledWith(MODELS.urdu)
    expect(screen.getByRole('status').textContent).toMatch(/Recording/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    })

    await waitFor(() => expect(onText).toHaveBeenCalledWith('Buner mein pani aa gaya hai'))
    const [model, audio, lang] = vi.mocked(transcribeOffline).mock.calls[0]
    expect(model).toBe(MODELS.urdu)
    expect(lang).toBe('urdu')
    // The recogniser gets a levelled copy; the page gets the untouched recording.
    expect(audio[0]).toBeCloseTo(0, 5)
    const recorded = onRecording.mock.calls[0][0] as Float32Array
    expect(recorded.length).toBe(16000 * 3)
    expect(recorded[0]).toBeCloseTo(0.01, 5)
    expect(track.stop).toHaveBeenCalled() // microphone released
    expect(screen.getByRole('status').textContent).toMatch(/Done\. Check the text/)
  })

  it('uses the English model for English', async () => {
    render(<OfflineVoiceInput models={MODELS} onText={() => {}} />)
    fireEvent.change(screen.getByLabelText('Voice language'), { target: { value: 'english' } })
    await recordAndStop()
    await waitFor(() => expect(transcribeOffline).toHaveBeenCalled())
    const [model, , lang] = vi.mocked(transcribeOffline).mock.calls[0]
    expect(model).toBe(MODELS.english)
    expect(lang).toBe('english')
  })

  it('explains a blocked microphone and does not convert anything', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const onText = vi.fn()
    render(<OfflineVoiceInput models={MODELS} onText={onText} />)
    fireEvent.click(screen.getByRole('button', { name: /Speak instead/ }))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/Microphone access is blocked/),
    )
    expect(transcribeOffline).not.toHaveBeenCalled()
    expect(onText).not.toHaveBeenCalled()
  })
})
