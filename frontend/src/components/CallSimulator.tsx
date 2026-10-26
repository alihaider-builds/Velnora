import { ArrowRight, Info, Mic, PhoneCall, Square, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useHealth, useSimulatorCall } from '../api/hooks'
import { toWav16k } from '../lib/wav'
import { Spinner, errorMessage } from './ui'

const MAX_SECONDS = 300
const DEMO_TRANSCRIPT =
  'Hum Lalkurti Cantt Rawalpindi mein hain, gali mein pani bhar gaya hai, 3 bachay hain, dawai aur khana chahiye.'

/** "Call the helpline": record from the microphone or pick an audio file, then send it through
 * the same path as a real recorded call. */
export function CallSimulator({ from }: { from: string }) {
  const health = useHealth()
  const call = useSimulatorCall()
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [audio, setAudio] = useState<{ wav: Blob; seconds: number; url: string } | null>(null)
  const [hint, setHint] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ reply: string; reportId: string } | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const speechModel = health.data?.transcriber_available === true

  useEffect(
    () => () => {
      clearInterval(timer.current)
      recorder.current?.stream.getTracks().forEach((t) => t.stop())
    },
    [],
  )
  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio.url)
    },
    [audio],
  )

  const loadAudio = async (blob: Blob) => {
    setError(null)
    setResult(null)
    try {
      const { wav, seconds } = await toWav16k(blob)
      if (seconds > MAX_SECONDS) throw new Error('Recordings must be 5 minutes or shorter.')
      setAudio({ wav, seconds, url: URL.createObjectURL(wav) })
    } catch (e) {
      setAudio(null)
      setError(
        e instanceof Error && e.message.startsWith('Recordings')
          ? e.message
          : "This audio can't be read.",
      )
    }
  }

  const start = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunks.current = []
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        void loadAudio(new Blob(chunks.current, { type: rec.mimeType }))
      }
      recorder.current = rec
      rec.start()
      setRecording(true)
      setElapsed(0)
      timer.current = setInterval(() => {
        setElapsed((s) => {
          if (s + 1 >= MAX_SECONDS) stop()
          return s + 1
        })
      }, 1000)
    } catch {
      setError(
        'Microphone not available. Allow microphone access, or upload an audio file instead.',
      )
    }
  }

  const stop = () => {
    clearInterval(timer.current)
    if (recorder.current?.state === 'recording') recorder.current.stop()
    setRecording(false)
  }

  const send = () => {
    if (!audio) return
    const form = new FormData()
    form.append('from', from)
    form.append('audio', audio.wav, 'call.wav')
    if (hint.trim()) form.append('transcript_hint', hint.trim())
    call.mutate(form, {
      onSuccess: (res) => setResult({ reply: res.reply, reportId: res.report_id }),
      onError: (err) => setError(errorMessage(err, "The call couldn't be sent.")),
    })
  }

  return (
    <div
      className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
      style={{ backgroundColor: 'var(--chat-sms-bg)' }}
    >
      <p className="flex gap-2 rounded-lg bg-surface p-3 text-sm">
        <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" />
        <span>
          Callers hear: "This call is recorded so volunteers can help. After the beep, say where you
          are and what you need."
        </span>
      </p>

      <div className="flex flex-col items-center gap-2 rounded-lg bg-surface p-4">
        {recording ? (
          <>
            <span
              className="flex items-center gap-2 text-sm font-semibold text-rejected"
              aria-live="polite"
            >
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rejected" /> Recording{' '}
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </span>
            <button type="button" className="btn btn-danger" onClick={stop}>
              <Square size={16} aria-hidden="true" /> Stop
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={start}>
            <Mic size={16} aria-hidden="true" /> {audio ? 'Record again' : 'Record a call'}
          </button>
        )}
        <label className="btn btn-sm cursor-pointer">
          <Upload size={14} aria-hidden="true" /> Or upload audio
          <input
            type="file"
            accept="audio/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void loadAudio(f)
              e.target.value = ''
            }}
          />
        </label>
        {audio && (
          <audio controls src={audio.url} className="w-full">
            Your browser can't play this recording.
          </audio>
        )}
      </div>

      {!speechModel && (
        <div className="flex flex-col gap-1 rounded-lg bg-surface p-3">
          <label htmlFor="call-hint" className="text-xs font-semibold text-muted">
            What the caller says (demo stand-in — no speech model is installed)
          </label>
          <textarea
            id="call-hint"
            dir="auto"
            rows={3}
            className="input text-sm"
            maxLength={5000}
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="Leave empty to have the reviewer type the transcript after listening."
          />
          <button
            type="button"
            className="link self-start text-xs"
            onClick={() => setHint(DEMO_TRANSCRIPT)}
          >
            Use example (Lalkurti, Rawalpindi)
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-rejected">
          {error}
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary"
        disabled={!audio || recording || call.isPending || from.replace(/\D/g, '').length < 10}
        onClick={send}
      >
        {call.isPending ? <Spinner /> : <PhoneCall size={16} aria-hidden="true" />} Send call to
        helpline
      </button>

      {result && (
        <div
          className="flex flex-col gap-1 rounded-2xl bg-surface p-3 text-sm shadow-card"
          aria-live="polite"
        >
          <span className="whitespace-pre-wrap">{result.reply}</span>
          <Link
            to={`/review/reports/${result.reportId}`}
            className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary"
          >
            Open in review queue <ArrowRight size={12} aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  )
}
