import { AlertTriangle, Loader2, Pencil, Phone } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { usePutTranscript } from '../api/hooks'
import type { Report } from '../api/types'
import { useToast } from './Toast'
import { errorMessage } from './ui'
import { formatPhone } from '../lib/format'

function duration(seconds: number | null): string {
  if (seconds === null) return ''
  const s = Math.round(seconds)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

const STATUS_TEXT: Record<string, string> = {
  pending: 'Waiting to transcribe…',
  running: 'Transcribing the call…',
  succeeded: 'Transcribed automatically — check it against the recording.',
  manual: 'Transcript typed by a reviewer.',
  failed: 'No transcript yet.',
}

/** Helpline call: the recording, the transcript status and a reviewer transcript editor. */
export function CallPanel({ report }: { report: Report }) {
  const call = report.call
  const put = usePutTranscript(report.id)
  const toast = useToast()
  const needsText = call?.transcript_status === 'failed'
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(report.source_text)
  if (!call) return null

  const busy = call.transcript_status === 'pending' || call.transcript_status === 'running'
  const open = editing || needsText

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    put.mutate(
      { text: text.trim() },
      {
        onSuccess: () => {
          toast('Transcript saved. The AI is reading it again.')
          setEditing(false)
        },
        onError: (err) => toast(errorMessage(err, "Couldn't save the transcript."), 'error'),
      },
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Phone size={15} aria-hidden="true" /> Helpline call
        {call.duration_seconds !== null && (
          <span className="font-normal text-muted">· {duration(call.duration_seconds)}</span>
        )}
      </p>
      <p className="text-xs text-muted">
        {call.helpline
          ? `Called ${call.helpline.label ?? 'helpline'} · ${formatPhone(call.helpline.number)}`
          : 'Called an unregistered number'}
      </p>
      {call.has_audio && call.audio_url && (
        <audio controls preload="metadata" src={call.audio_url} className="w-full">
          Your browser can't play this recording.
        </audio>
      )}
      <p
        className={`flex items-start gap-1.5 text-sm ${needsText ? 'font-medium text-flagged' : 'text-muted'}`}
      >
        {busy ? (
          <Loader2 size={15} aria-hidden="true" className="mt-0.5 shrink-0 animate-spin" />
        ) : needsText ? (
          <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
        ) : null}
        <span>
          {STATUS_TEXT[call.transcript_status]}
          {needsText && call.transcript_error ? ` ${call.transcript_error}` : ''}
          {call.transcript_model && !needsText && call.transcript_status !== 'manual' && (
            <span className="block text-xs">Model: {call.transcript_model}</span>
          )}
        </span>
      </p>

      {open && !busy ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <label htmlFor="transcript" className="text-xs font-semibold text-muted">
            {needsText ? 'Listen, then type what the caller said' : 'Correct the transcript'}
          </label>
          <textarea
            id="transcript"
            dir="auto"
            className="input min-h-24"
            maxLength={5000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Misal: Hum Lalkurti, Rawalpindi mein hain, 3 bachay hain, dawai chahiye"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={put.isPending || !text.trim()}
            >
              {put.isPending ? 'Saving…' : 'Save transcript'}
            </button>
            {editing && (
              <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        !busy && (
          <button
            type="button"
            className="btn btn-sm self-start"
            onClick={() => {
              setText(report.source_text)
              setEditing(true)
            }}
          >
            <Pencil size={14} aria-hidden="true" /> Edit transcript
          </button>
        )
      )}
    </div>
  )
}
