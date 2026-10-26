import { Camera, MapPin, Mic, Phone, Send, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useDemoMode, useHelplines, useSubmitReport } from '../api/hooks'
import { CoordinateInput } from '../components/CoordinateInput'
import { Dialog } from '../components/Dialog'
import { MapView, type MapMarker } from '../components/MapView'
import { PlaceAutocomplete } from '../components/PlaceAutocomplete'
import { Spinner } from '../components/ui'
import { VoiceInput } from '../components/VoiceInput'
import { PAKISTAN_BOUNDS } from '../lib/config'
import { formatCoords, formatPhone } from '../lib/format'
import { codePoints } from '../lib/text'
import { encodeWav } from '../lib/wav'

// Mirrors the backend's validation (POST /api/reports); the server stays authoritative.
const MIN = 10
const MAX = 2000
const MAX_PLACE = 200
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE = 5 * 1024 * 1024

type Point = { lat: number; lng: number }
type FieldErrors = {
  text?: string
  place?: string
  location?: string
  image?: string
  voice?: string
  form?: string
}

// Voice notes: 16 kHz mono WAV, at most 5 minutes (backend MAX_CALL_SECONDS / MAX_AUDIO_BYTES).
const VOICE_RATE = 16_000
const MAX_VOICE_SECONDS = 300
const AUDIO_ERRORS = ['UNSUPPORTED_AUDIO', 'AUDIO_TOO_LARGE', 'AUDIO_TOO_LONG']

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`

const inPakistan = (p: Point) =>
  p.lat >= PAKISTAN_BOUNDS.minLat &&
  p.lat <= PAKISTAN_BOUNDS.maxLat &&
  p.lng >= PAKISTAN_BOUNDS.minLng &&
  p.lng <= PAKISTAN_BOUNDS.maxLng

/**
 * Maps a 400 VALIDATION_ERROR to per-field messages. The backend sends
 * `details.fields: [{ field, message }]`; an older single `details.field` is also accepted.
 */
function fieldErrors(err: ApiError): FieldErrors {
  const list = Array.isArray(err.details.fields)
    ? (err.details.fields as { field?: string; message?: string }[])
    : err.details.field
      ? [{ field: String(err.details.field), message: err.message }]
      : []
  const out: FieldErrors = {}
  for (const f of list) {
    const msg = f.message || err.message
    if (f.field === 'text') out.text = msg
    else if (f.field === 'place_text') out.place = msg
    else if (f.field === 'lat' || f.field === 'lng') out.location = msg
    else if (f.field === 'image') out.image = msg
  }
  if (Object.keys(out).length === 0) out.form = err.message
  return out
}

function PinPickerDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial: Point | null
  onSave: (p: Point) => void
}) {
  const [draft, setDraft] = useState<Point | null>(initial)
  const [jump, setJump] = useState<Point | null>(null)
  const markers = useMemo<MapMarker[]>(
    () => (draft ? [{ id: 'pin', ...draft, kind: 'selected', label: 'Your pin' }] : []),
    [draft],
  )
  const outside = draft !== null && !inPakistan(draft)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Pick on the map"
      description="Tap the map to drop a pin. Drag it to adjust."
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!draft || outside}
            onClick={() => draft && onSave(draft)}
          >
            Use this location
          </button>
        </>
      }
    >
      <MapView
        label="Map for choosing a location"
        className="h-[55vh] min-h-72"
        markers={markers}
        focus={jump ? { ...jump, zoom: 14 } : initial ? { ...initial, zoom: 11 } : null}
        onPick={(lat, lng) => setDraft({ lat, lng })}
        onDrag={(lat, lng) => setDraft({ lat, lng })}
      />
      <div className="mt-3">
        <CoordinateInput
          onSet={(lat, lng) => {
            setDraft({ lat, lng })
            setJump({ lat, lng })
          }}
        />
      </div>
      <p className="mt-3 text-sm text-muted" aria-live="polite">
        {draft ? `Selected: ${formatCoords(draft.lat, draft.lng)}` : 'No pin yet.'}
        {outside && (
          <span className="ml-2 font-medium text-rejected">Choose a place inside Pakistan.</span>
        )}
      </p>
    </Dialog>
  )
}

export function Submit() {
  const navigate = useNavigate()
  const demoMode = useDemoMode()
  const submit = useSubmitReport()
  const helplines = useHelplines().data?.items ?? []

  const [text, setText] = useState('')
  const [place, setPlace] = useState('')
  const [point, setPoint] = useState<Point | null>(null)
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  // The submitter's dictation recordings, joined into one voice note for the reviewer.
  const [voice, setVoice] = useState<Float32Array | null>(null)
  const [sendVoice, setSendVoice] = useState(true)
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null)
  const [voiceCapped, setVoiceCapped] = useState(false)
  const voiceSeconds = voice ? voice.length / VOICE_RATE : 0

  useEffect(() => {
    if (!voice) return
    const url = URL.createObjectURL(encodeWav(voice, VOICE_RATE))
    // eslint-disable-next-line react-hooks/set-state-in-effect -- playback URL tracks the recording
    setVoiceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [voice])

  const addRecording = (samples: Float32Array) => {
    setErrors((e) => ({ ...e, voice: undefined }))
    setVoice((cur) => {
      const used = cur?.length ?? 0
      const room = MAX_VOICE_SECONDS * VOICE_RATE - used
      if (room <= 0) {
        setVoiceCapped(true)
        return cur
      }
      const part = samples.length > room ? samples.subarray(0, room) : samples
      if (part.length < samples.length) setVoiceCapped(true)
      const joined = new Float32Array(used + part.length)
      if (cur) joined.set(cur)
      joined.set(part, used)
      return joined
    })
  }

  const removeVoice = () => {
    setVoice(null)
    setVoiceUrl(null)
    setVoiceCapped(false)
    setErrors((e) => ({ ...e, voice: undefined }))
  }

  const length = codePoints(text.trim()).length
  const textError =
    length < MIN
      ? `Write at least ${MIN} characters.`
      : length > MAX
        ? `Keep it under ${MAX.toLocaleString()} characters.`
        : undefined

  useEffect(() => {
    if (!image) return
    const url = URL.createObjectURL(image)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preview URL tracks the chosen file
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  const chooseImage = (file: File | undefined) => {
    setErrors((e) => ({ ...e, image: undefined }))
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) {
      setErrors((e) => ({ ...e, image: 'Use a JPG, PNG or WebP photo.' }))
      return
    }
    if (file.size > MAX_IMAGE) {
      setErrors((e) => ({ ...e, image: 'Photo must be 5 MB or smaller.' }))
      return
    }
    setImage(file)
  }

  const removeImage = () => {
    setImage(null)
    setPreview(null)
  }

  /** Voice typing appends to whatever is already written; the user can edit everything. */
  const appendSpeech = (chunk: string) =>
    setText((cur) => (cur.trim() ? `${cur.replace(/\s+$/, '')} ${chunk}` : chunk))

  const clearLocation = () => {
    setPlace('')
    setPoint(null)
    setErrors((e) => ({ ...e, place: undefined, location: undefined }))
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (textError || submit.isPending) return
    if (place.trim().length > MAX_PLACE) {
      setErrors({ place: `Keep the place under ${MAX_PLACE} characters.` })
      return
    }

    const form = new FormData()
    form.set('text', text.trim())
    if (place.trim()) form.set('place_text', place.trim())
    if (point) {
      form.set('lat', String(point.lat))
      form.set('lng', String(point.lng))
    }
    if (image) form.set('image', image)
    if (voice && sendVoice) form.set('audio', encodeWav(voice, VOICE_RATE), 'voice-note.wav')
    if (demoMode) form.set('is_synthetic', 'true')

    setErrors({})
    submit.mutate(form, {
      onSuccess: (res) => navigate(`/submit/done/${encodeURIComponent(res.reference)}`),
      onError: (err) => {
        if (!(err instanceof ApiError))
          return setErrors({ form: 'Something went wrong. Try again.' })
        if (AUDIO_ERRORS.includes(err.code)) return setErrors({ voice: err.message })
        if (err.status === 413 || err.status === 415) return setErrors({ image: err.message })
        if (err.status === 429)
          return setErrors({
            form: 'Too many reports from this connection. Try again in a minute.',
          })
        if (err.status === 400) return setErrors(fieldErrors(err))
        setErrors({
          form:
            err.status === 0
              ? "Can't reach the server. Check your connection and try again."
              : err.message,
        })
      },
    })
  }

  const showTextError = (touched && textError) || errors.text

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 lg:py-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Submit a report</h1>
      </div>

      <form
        onSubmit={onSubmit}
        noValidate
        aria-busy={submit.isPending}
        className="card grid gap-x-6 gap-y-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
      >
        {/* Left: description + voice typing */}
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor="report-text" className="label mb-0">
            What is happening and what help is needed?
          </label>
          <textarea
            id="report-text"
            dir="auto"
            rows={7}
            className="input min-h-40 flex-1 resize-y leading-relaxed"
            placeholder="Type here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showTextError ? true : undefined}
            aria-describedby="report-text-help"
          />
          <div id="report-text-help" className="flex justify-between gap-3 text-sm">
            <span className={showTextError ? 'text-rejected' : 'text-muted'}>
              {showTextError || ''}
            </span>
            <span
              className={`shrink-0 tabular-nums ${length > MAX ? 'text-rejected' : 'text-muted'}`}
              aria-live="polite"
            >
              {length.toLocaleString()} / {MAX.toLocaleString()}
            </span>
          </div>
          <VoiceInput
            onText={appendSpeech}
            onRecording={addRecording}
            disabled={submit.isPending}
          />
          {voice && (
            <div className="rounded-lg border border-border px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Mic size={15} aria-hidden="true" className="shrink-0 text-primary" />
                <span className="text-sm font-medium">Voice recording · {clock(voiceSeconds)}</span>
                {voiceUrl && (
                  <audio
                    controls
                    preload="metadata"
                    src={voiceUrl}
                    aria-label="Play your voice recording"
                    className="h-9 min-w-0 flex-1"
                  />
                )}
                <button type="button" className="btn btn-ghost btn-sm px-2" onClick={removeVoice}>
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </button>
              </div>
              <label className="mt-1 flex min-h-11 items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                  checked={sendVoice}
                  onChange={(e) => setSendVoice(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Send my voice recording with the report</span>
                  <span className="block text-muted">
                    A reviewer can listen to check the text. Only reviewers can hear it; it is never
                    shown on the public map.
                  </span>
                </span>
              </label>
              {voiceCapped && (
                <p className="text-xs text-muted">
                  Voice notes are limited to 5 minutes; later speech is in the text but not in the
                  recording.
                </p>
              )}
              {errors.voice && (
                <p role="alert" className="text-xs font-medium text-rejected">
                  {errors.voice}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right: location + photo */}
        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <label htmlFor="report-place" className="label">
              Where?
            </label>
            <PlaceAutocomplete
              id="report-place"
              value={place}
              onChange={(v) => {
                setPlace(v)
                setErrors((e) => ({ ...e, place: undefined }))
              }}
              onSelect={(sug) => {
                setPlace(sug.label)
                if (sug.lat !== null && sug.lng !== null) setPoint({ lat: sug.lat, lng: sug.lng })
              }}
              describedBy="report-place-help"
              invalid={!!errors.place}
            />
            {errors.place && (
              <p id="report-place-help" className="mt-1 text-xs text-rejected">
                {errors.place}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5">
              <MapPin
                size={16}
                aria-hidden="true"
                className={point ? 'shrink-0 text-primary' : 'shrink-0 text-muted'}
              />
              <span className="min-w-0 flex-1 text-sm" aria-live="polite">
                {point ? (
                  <>
                    <span className="font-medium">Pin set</span>{' '}
                    <span className="font-mono text-xs text-muted" dir="ltr">
                      {formatCoords(point.lat, point.lng)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted">No map pin</span>
                )}
              </span>
              <button type="button" className="btn btn-sm" onClick={() => setPickerOpen(true)}>
                {point ? 'Change pin' : 'Pick on map'}
              </button>
              {(point || place) && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm px-2"
                  onClick={clearLocation}
                  aria-label="Clear location"
                >
                  <X size={15} aria-hidden="true" /> Clear
                </button>
              )}
            </div>
            {errors.location && (
              <p role="alert" className="mt-1 text-xs font-medium text-rejected">
                {errors.location}
              </p>
            )}
          </div>

          <div>
            <span className="label" id="photo-label">
              Photo
            </span>
            {image && preview ? (
              <div className="flex items-center gap-3">
                <img
                  src={preview}
                  alt="Selected photo preview"
                  className="h-16 w-16 shrink-0 rounded-lg border border-border object-cover"
                />
                <p className="min-w-0 flex-1 truncate text-sm font-medium" title={image.name}>
                  {image.name}
                </p>
                <label className="btn btn-sm cursor-pointer">
                  Replace
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    aria-label="Replace photo"
                    onChange={(e) => {
                      chooseImage(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </label>
                <button type="button" className="btn btn-ghost btn-sm px-2" onClick={removeImage}>
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </button>
              </div>
            ) : (
              <label className="btn cursor-pointer">
                <Camera size={16} aria-hidden="true" /> Add photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  aria-labelledby="photo-label"
                  aria-describedby="photo-help"
                  onChange={(e) => {
                    chooseImage(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </label>
            )}
            {errors.image && (
              <p id="photo-help" role="alert" className="mt-1 text-xs font-medium text-rejected">
                {errors.image}
              </p>
            )}
          </div>

          {helplines.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Phone size={15} aria-hidden="true" className="text-primary" />
              <span className="text-muted">Prefer to talk? Call</span>
              {helplines.map((h) => (
                <a key={h.number} href={`tel:${h.number}`} dir="ltr" className="link font-mono">
                  {formatPhone(h.number)}
                </a>
              ))}
            </p>
          )}
        </div>

        {/* Submit bar spans both columns */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 lg:col-span-2">
          {errors.form && (
            <p role="alert" className="w-full text-sm font-medium text-rejected lg:w-auto">
              {errors.form}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary w-full sm:ml-auto sm:w-auto"
            disabled={!!textError || submit.isPending}
          >
            {submit.isPending ? (
              <Spinner label="Sending…" />
            ) : (
              <>
                <Send size={16} aria-hidden="true" /> Submit report
              </>
            )}
          </button>
        </div>
      </form>

      {pickerOpen && (
        <PinPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initial={point}
          onSave={(p) => {
            setPoint(p)
            setErrors((e) => ({ ...e, location: undefined }))
            setPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}
