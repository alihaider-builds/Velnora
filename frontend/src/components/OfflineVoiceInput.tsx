import { Loader2, Mic, Square, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { prepareForRecognition } from '../lib/audioPrep'
import { preloadOfflineVoice, transcribeOffline, type OfflineModels } from '../lib/offlineSpeech'
import { micErrorMessage, micUnavailableReason, openMic } from '../lib/mic'
import { toMono16k } from '../lib/wav'

const LANGUAGES = [
  { code: 'urdu', label: 'اردو (Urdu)' },
  { code: 'english', label: 'English' },
] as const
type Lang = (typeof LANGUAGES)[number]['code']

const MAX_SECONDS = 120

type Status = 'idle' | 'recording' | 'transcribing' | 'error'

/**
 * Offline voice typing: records the microphone, then the Whisper model (served by this app,
 * run in the browser) turns the speech into text. Works without internet; the recording stays
 * in memory only and is discarded after conversion — nothing is uploaded or stored.
 */
export function OfflineVoiceInput({
  models,
  onText,
  onRecording,
  disabled = false,
}: {
  /** Offline model per language (Urdu uses the larger, more accurate one when installed). */
  models: OfflineModels
  onText: (chunk: string) => void
  /** Receives each recording (16 kHz mono samples) so the page can attach it to the report. */
  onRecording?: (samples: Float32Array) => void
  disabled?: boolean
}) {
  const [lang, setLang] = useState<Lang>('urdu')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [progress, setProgress] = useState<number | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<number | null>(null)
  const onTextRef = useRef(onText)
  const onRecordingRef = useRef(onRecording)
  useEffect(() => {
    onTextRef.current = onText
    onRecordingRef.current = onRecording
  })

  const releaseMic = () => {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }

  // Release the microphone if the page is left mid-recording.
  useEffect(
    () => () => {
      if (recorder.current?.state === 'recording') {
        recorder.current.onstop = null
        recorder.current.stop()
      }
      releaseMic()
    },
    [],
  )

  const convert = async (blob: Blob) => {
    setStatus('transcribing')
    setProgress(null)
    setMessage(
      models.urdu !== models.english && lang === 'urdu'
        ? 'Converting speech to text on this device… Urdu uses a larger model for accuracy, so this takes a little longer.'
        : 'Converting speech to text on this device…',
    )
    try {
      const { samples, seconds: length } = await toMono16k(blob)
      if (length < 0.5) throw new Error('too-short')
      // The worker takes ownership of `samples`, so the page gets its own copy.
      onRecordingRef.current?.(samples.slice())
      const text = await transcribeOffline(
        models[lang],
        prepareForRecognition(samples),
        lang,
        (p) => setProgress(p),
      )
      if (text) {
        onTextRef.current(text)
        setMessage('Done. Check the text above and edit it if needed.')
      } else {
        setMessage('No speech was recognised. Try again a little closer to the microphone.')
      }
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setMessage(
        err instanceof Error && err.message === 'too-short'
          ? 'The recording was too short. Hold Speak a little longer.'
          : "The speech couldn't be converted. Try again, or type your report.",
      )
    } finally {
      setProgress(null)
    }
  }

  const start = async () => {
    const blocked = micUnavailableReason()
    if (blocked) {
      setStatus('error')
      setMessage(blocked)
      return
    }
    try {
      stream.current = await openMic()
    } catch (err) {
      setStatus('error')
      setMessage(micErrorMessage(err))
      return
    }
    preloadOfflineVoice(models[lang]) // load the speech model while the user talks
    chunks.current = []
    const rec = new MediaRecorder(stream.current)
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    rec.onstop = () => {
      releaseMic()
      const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
      chunks.current = []
      void convert(blob)
    }
    recorder.current = rec
    rec.start()
    setSeconds(0)
    setStatus('recording')
    setMessage('Recording… speak your report, then press Stop.')
    const began = Date.now()
    timer.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - began) / 1000)
      setSeconds(s)
      if (s >= MAX_SECONDS && rec.state === 'recording') rec.stop()
    }, 250)
  }

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  const recording = status === 'recording'
  const busy = status === 'transcribing'
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`btn btn-sm ${recording ? 'btn-danger' : ''}`}
          aria-pressed={recording}
          disabled={busy || (disabled && !recording)}
          onClick={recording ? stop : () => void start()}
        >
          {recording ? (
            <>
              <Square size={14} aria-hidden="true" /> Stop
            </>
          ) : busy ? (
            <>
              <Loader2 size={14} aria-hidden="true" className="animate-spin" /> Converting…
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
          disabled={recording || busy}
          onChange={(e) => setLang(e.target.value as Lang)}
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        {recording ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rejected">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-rejected" />
            Recording {clock}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-verified px-2 py-0.5 text-xs font-medium text-verified-ink">
            <WifiOff size={12} aria-hidden="true" /> Works offline
          </span>
        )}
      </div>
      <p
        role="status"
        aria-live="polite"
        className={`mt-1 text-xs ${status === 'error' ? 'font-medium text-rejected' : 'text-muted'}`}
      >
        {message || 'Speech becomes editable text. Nothing is sent until you press Submit.'}
        {busy && progress !== null && progress < 100 && ` Loading speech model ${progress}%`}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted">
        Speech is converted on this device by an offline speech model — no internet needed. For
        Roman Urdu, speak Urdu or English and edit the text.
      </p>
    </div>
  )
}
