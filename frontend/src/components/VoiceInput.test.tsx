import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserVoiceInput } from './VoiceInput'

/** Controllable stand-in for the browser's SpeechRecognition. */
class FakeRecognition {
  static last: FakeRecognition | null = null
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false
  stopped = false
  constructor() {
    FakeRecognition.last = this
  }
  start() {
    this.started = true
  }
  stop() {
    this.stopped = true
    this.onend?.()
  }
  abort() {}
  emit(transcript: string, isFinal: boolean) {
    const result = Object.assign([{ transcript }], { isFinal })
    this.onresult?.({ resultIndex: 0, results: Object.assign([result], { length: 1 }) })
  }
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  FakeRecognition.last = null
})

const install = () => {
  ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition
}

describe('BrowserVoiceInput (browser speech service)', () => {
  it('explains when the browser has no speech recognition', () => {
    render(<BrowserVoiceInput onText={() => {}} />)
    expect(screen.getByText(/Voice typing isn't available in this browser/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Speak/ })).toBeNull()
  })

  it('listens, hands over final text, and shows a stopped state', () => {
    install()
    const onText = vi.fn()
    render(<BrowserVoiceInput onText={onText} />)
    fireEvent.click(screen.getByRole('button', { name: /Speak instead/ }))
    const rec = FakeRecognition.last!
    expect(rec.started).toBe(true)
    expect(rec.lang).toBe('ur-PK')
    expect(screen.getByRole('button', { name: /Stop/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('status').textContent).toMatch(/Listening/)

    act(() => rec.emit('pani aa gaya', false))
    expect(onText).not.toHaveBeenCalled()
    expect(screen.getByText('pani aa gaya…')).toBeTruthy()

    act(() => rec.emit('pani aa gaya hai', true))
    expect(onText).toHaveBeenCalledWith('pani aa gaya hai')

    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    expect(rec.stopped).toBe(true)
    expect(screen.getByRole('status').textContent).toMatch(/Stopped\. Check the text/)
    expect(screen.getByRole('button', { name: /Speak instead/ })).toBeTruthy()
  })

  it('reports a blocked microphone', () => {
    install()
    render(<BrowserVoiceInput onText={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Speak instead/ }))
    act(() => {
      FakeRecognition.last!.onerror?.({ error: 'not-allowed' })
      FakeRecognition.last!.onend?.()
    })
    expect(screen.getByRole('status').textContent).toMatch(/Microphone access is blocked/)
  })

  it('says so when nothing was recognised', () => {
    install()
    const onText = vi.fn()
    render(<BrowserVoiceInput onText={onText} />)
    fireEvent.click(screen.getByRole('button', { name: /Speak instead/ }))
    act(() => FakeRecognition.last!.onend?.())
    expect(onText).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toMatch(/No speech was recognised/)
  })

  it('uses the chosen language', () => {
    install()
    render(<BrowserVoiceInput onText={() => {}} />)
    fireEvent.change(screen.getByLabelText('Voice language'), { target: { value: 'en-US' } })
    fireEvent.click(screen.getByRole('button', { name: /Speak instead/ }))
    expect(FakeRecognition.last!.lang).toBe('en-US')
  })
})

describe('VoiceInput offline (on-device) mode', () => {
  let onLine = true
  const realOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')
  beforeEach(() => {
    onLine = true
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => onLine })
  })
  afterEach(() => {
    if (realOnLine) Object.defineProperty(Navigator.prototype, 'onLine', realOnLine)
    delete (FakeRecognition as unknown as Record<string, unknown>).available
    delete (FakeRecognition as unknown as Record<string, unknown>).install
  })

  const withLocal = (state: string, installResult = true) => {
    const ctor = FakeRecognition as unknown as Record<string, unknown>
    ctor.available = vi.fn(async () => state)
    ctor.install = vi.fn(async () => {
      state = 'available'
      return installResult
    })
    install()
    return ctor
  }

  it('recognises on the device when the language pack is installed', async () => {
    withLocal('available')
    render(<BrowserVoiceInput onText={() => {}} />)
    expect(await screen.findByText('Works offline')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Speak instead/ }))
    expect((FakeRecognition.last as unknown as { processLocally?: boolean }).processLocally).toBe(
      true,
    )
    expect(screen.getByText(/Listening \(offline\)/)).toBeTruthy()
  })

  it('offers a one-time download and switches to offline when it finishes', async () => {
    const ctor = withLocal('downloadable')
    render(<BrowserVoiceInput onText={() => {}} />)
    expect(await screen.findByText('Needs internet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Download for offline use/ }))
    await waitFor(() => expect(screen.getByText('Works offline')).toBeTruthy())
    expect(ctor.install).toHaveBeenCalledWith({ langs: ['ur-PK'], processLocally: true })
    expect(screen.getByRole('status').textContent).toMatch(/now works without internet/)
  })

  it("explains instead of failing when offline and the language can't run on the device", async () => {
    onLine = false
    withLocal('unavailable')
    render(<BrowserVoiceInput onText={() => {}} />)
    await screen.findByText('Needs internet')
    fireEvent.click(screen.getByRole('button', { name: /Speak instead/ }))
    expect(FakeRecognition.last).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/can't recognise Urdu without internet/)
  })

  it('gives a clear message when the online speech service is unreachable', () => {
    install()
    render(<BrowserVoiceInput onText={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Speak instead/ }))
    act(() => {
      FakeRecognition.last!.onerror?.({ error: 'network' })
      FakeRecognition.last!.onend?.()
    })
    expect(screen.getByRole('status').textContent).toMatch(
      /online speech service couldn't be reached/,
    )
  })
})
