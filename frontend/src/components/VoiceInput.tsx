import { Download, Mic, MicOff, Square, Wifi, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { micUnavailableReason } from '../lib/mic'
import { offlineVoiceModels, type OfflineModels } from '../lib/offlineSpeech'
import { OfflineVoiceInput } from './OfflineVoiceInput'

/**
 * Voice typing for the report description. Uses the offline Whisper model when it is installed
 * (`npm run setup:voice`): works in any modern browser, in Urdu and English, without internet.
 * Otherwise falls back to the browser's own speech recognition (usually online).
 */
export function VoiceInput({
  onRecording,
  ...props
}: {
  onText: (chunk: string) => void
  /** Offline mode only: each recording, so the page can attach it as a voice note. */
  onRecording?: (samples: Float32Array) => void
  disabled?: boolean
}) {
  const [models, setModels] = useState<OfflineModels | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void offlineVoiceModels().then((m) => live && setModels(m))
    return () => {
      live = false
    }
  }, [])
  if (models === undefined) return <div className="min-h-24" aria-hidden="true" />
  return models ? (
    <OfflineVoiceInput models={models} onRecording={onRecording} {...props} />
  ) : (
    <BrowserVoiceInput {...props} />
  )
}

// Minimal typings for the Web Speech API (not in TypeScript's DOM lib; Chrome/Edge expose it as
// webkitSpeechRecognition). `processLocally`, `available()` and `install()` are the newer
// on-device extensions (Chrome 139+); they are feature-detected before use.
interface RecognitionAlternative {
  transcript: string
}
interface RecognitionResult {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: RecognitionAlternative
}
interface RecognitionEvent {
  readonly resultIndex: number
  readonly results: { readonly length: number; [index: number]: RecognitionResult }
}
interface RecognitionErrorEvent {
  readonly error: string
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  processLocally?: boolean
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type LocalAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable'
interface LocalOptions {
  langs: string[]
  processLocally: true
}
type RecognitionCtor = (new () => Recognition) & {
  available?: (o: LocalOptions) => Promise<LocalAvailability>
  install?: (o: LocalOptions) => Promise<boolean>
}

// eslint-disable-next-line react-refresh/only-export-components
export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const LANGUAGES = [
  { code: 'ur-PK', label: 'اردو (Urdu)' },
  { code: 'en-US', label: 'English' },
] as const

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed':
    'Microphone access is blocked. Click the lock or site-settings icon next to the address, allow the microphone, then try again.',
  'service-not-allowed': 'Voice typing is turned off in this browser. Type your report instead.',
  'no-speech': 'No speech was heard. Try again a little closer to the microphone.',
  'audio-capture': 'No microphone was found. Connect one, or type your report.',
  'language-not-supported':
    "This browser can't recognise the chosen language. Try the other one, or type instead.",
}

/** On-device support for one language: 'none' = this browser has no on-device mode at all. */
type Local = LocalAvailability | 'none' | 'checking'

function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

type Status = 'idle' | 'listening' | 'error'

/**
 * Browser speech-to-text for the report description. Recognised text is handed to `onText`
 * (the caller appends it to the editable text area); nothing is submitted automatically, and
 * ReliefLens itself never records or uploads audio.
 *
 * When the browser can recognise the language on the device (Chrome's on-device mode), it is
 * used, so voice typing keeps working without internet; otherwise the browser's online service
 * is used and the UI says so.
 */
export function BrowserVoiceInput({
  onText,
  disabled = false,
}: {
  onText: (chunk: string) => void
  disabled?: boolean
}) {
  const [Ctor] = useState(() => getRecognitionCtor())
  const online = useOnline()
  const [lang, setLang] = useState<string>(LANGUAGES[0].code)
  const [local, setLocal] = useState<Record<string, Local>>({})
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [interim, setInterim] = useState('')
  const recRef = useRef<Recognition | null>(null)
  const heardRef = useRef(false)
  const failedRef = useRef(false)
  const onTextRef = useRef(onText)
  useEffect(() => {
    onTextRef.current = onText
  })

  const canCheckLocal = !!Ctor && typeof Ctor.available === 'function'
  const localState: Local = !canCheckLocal ? 'none' : (local[lang] ?? 'checking')
  const offlineReady = localState === 'available'

  // Ask the browser whether this language can be recognised on the device.
  useEffect(() => {
    if (!Ctor?.available) return
    let cancelled = false
    Ctor.available({ langs: [lang], processLocally: true }).then(
      (a) => !cancelled && setLocal((m) => ({ ...m, [lang]: a })),
      () => !cancelled && setLocal((m) => ({ ...m, [lang]: 'unavailable' })),
    )
    return () => {
      cancelled = true
    }
  }, [Ctor, lang])

  // Stop listening if the component goes away mid-session.
  useEffect(() => () => recRef.current?.abort(), [])

  const langLabel = LANGUAGES.find((l) => l.code === lang)?.label ?? lang

  const download = async () => {
    if (!Ctor?.install) return
    setLocal((m) => ({ ...m, [lang]: 'downloading' }))
    setMessage(`Downloading ${langLabel} for offline voice typing…`)
    try {
      const ok = await Ctor.install({ langs: [lang], processLocally: true })
      const now = (await Ctor.available?.({ langs: [lang], processLocally: true })) ?? 'unavailable'
      setLocal((m) => ({ ...m, [lang]: ok ? now : 'unavailable' }))
      setMessage(
        ok && now === 'available'
          ? `${langLabel} is ready — voice typing now works without internet.`
          : "The offline download didn't finish. Voice typing still works online.",
      )
    } catch {
      setLocal((m) => ({ ...m, [lang]: 'downloadable' }))
      setMessage("The offline download didn't finish. Try again while connected.")
    }
  }

  // Without internet, only on-device recognition can work.
  const blockedOffline = !online && !offlineReady

  const offlineHelp = (): string => {
    if (localState === 'downloadable')
      return `You're offline. Reconnect once and press "Download for offline use" to type ${langLabel} by voice without internet.`
    if (lang === 'ur-PK')
      return "You're offline. This browser can't recognise Urdu without internet yet — type your report, or switch to English if its offline voice is downloaded."
    return "You're offline, and this browser only does voice typing online. In Google Chrome you can download English for offline use. You can always type instead."
  }

  const start = () => {
    if (!Ctor) return
    if (!window.isSecureContext) {
      setStatus('error')
      setMessage(micUnavailableReason() ?? '')
      return
    }
    if (blockedOffline) {
      setStatus('error')
      setMessage(offlineHelp())
      return
    }
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    if (offlineReady) rec.processLocally = true
    heardRef.current = false
    failedRef.current = false

    rec.onresult = (e) => {
      let finalText = ''
      let pending = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) finalText += transcript
        else pending += transcript
      }
      if (finalText.trim()) {
        heardRef.current = true
        onTextRef.current(finalText.trim())
      }
      setInterim(pending.trim())
    }
    rec.onerror = (e) => {
      if (e.error === 'aborted') return
      failedRef.current = true
      setStatus('error')
      setMessage(
        e.error === 'network'
          ? navigator.onLine
            ? "This browser's online speech service couldn't be reached. Try again, or type your report."
            : offlineHelp()
          : (ERROR_MESSAGES[e.error] ?? 'Voice typing stopped because of an error. Try again.'),
      )
    }
    rec.onend = () => {
      recRef.current = null
      setInterim('')
      if (failedRef.current) return
      setStatus('idle')
      setMessage(
        heardRef.current
          ? 'Stopped. Check the text above and edit it if needed.'
          : 'Stopped. No speech was recognised.',
      )
    }

    try {
      rec.start()
      recRef.current = rec
      setStatus('listening')
      setMessage('Listening… speak your report, then press Stop.')
    } catch {
      setStatus('error')
      setMessage('Voice typing could not start. Try again.')
    }
  }

  const stop = () => recRef.current?.stop()

  if (!Ctor) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
        <MicOff size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        Voice typing isn't available in this browser. Try Chrome or Edge, or type your report.
      </p>
    )
  }

  const listening = status === 'listening'
  const modeBadge = offlineReady ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-verified px-2 py-0.5 text-xs font-medium text-verified-ink">
      <WifiOff size={12} aria-hidden="true" /> Works offline
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted">
      <Wifi size={12} aria-hidden="true" /> Needs internet
    </span>
  )

  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn btn-sm ${listening ? 'btn-danger' : ''}`}
          aria-pressed={listening}
          disabled={disabled && !listening}
          onClick={listening ? stop : start}
        >
          {listening ? (
            <>
              <Square size={14} aria-hidden="true" /> Stop
            </>
          ) : (
            <>
              <Mic size={14} aria-hidden="true" /> Speak instead
            </>
          )}
        </button>
        <label htmlFor="voice-lang" className="sr-only">
          Voice language
        </label>
        <select
          id="voice-lang"
          className="input w-auto min-w-0 py-1 text-sm"
          value={lang}
          disabled={listening}
          onChange={(e) => {
            setLang(e.target.value)
            setStatus('idle')
            setMessage('')
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        {listening ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rejected">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-rejected" />
            Listening{offlineReady ? ' (offline)' : ''}
          </span>
        ) : (
          localState !== 'checking' && modeBadge
        )}
        {!listening && (localState === 'downloadable' || localState === 'downloading') && (
          <button
            type="button"
            className="btn btn-ghost btn-sm text-xs"
            onClick={download}
            disabled={localState === 'downloading' || !online}
          >
            <Download size={13} aria-hidden="true" />
            {localState === 'downloading' ? 'Downloading…' : 'Download for offline use'}
          </button>
        )}
      </div>
      <p
        role="status"
        aria-live="polite"
        className={`mt-1 text-xs ${status === 'error' ? 'font-medium text-rejected' : 'text-muted'}`}
      >
        {message ||
          (blockedOffline
            ? offlineHelp()
            : 'Speech becomes editable text. Nothing is sent until you press Submit.')}
      </p>
      {interim && (
        <p dir="auto" className="mt-1 text-sm italic text-muted">
          {interim}…
        </p>
      )}
      <p className="mt-1 text-[11px] leading-snug text-muted">
        {offlineReady
          ? 'Speech is recognised on this device; no audio leaves your computer.'
          : "Your browser converts the speech; online this uses the browser maker's speech service."}{' '}
        ReliefLens doesn't record or upload audio. For Roman Urdu, speak Urdu or English and edit
        the text.
      </p>
    </div>
  )
}
