import { Camera, Lock, MapPin, Send, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useDemoMode, useSubmitReport } from '../api/hooks'
import { CoordinateInput } from '../components/CoordinateInput'
import { Dialog } from '../components/Dialog'
import { MapView, type MapMarker } from '../components/MapView'
import { Callout, Spinner } from '../components/ui'
import { PAKISTAN_BOUNDS } from '../lib/config'
import { formatCoords } from '../lib/format'
import { codePoints } from '../lib/text'

const MIN = 10
const MAX = 2000
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE = 5 * 1024 * 1024

type Point = { lat: number; lng: number }

const inPakistan = (p: Point) =>
  p.lat >= PAKISTAN_BOUNDS.minLat &&
  p.lat <= PAKISTAN_BOUNDS.maxLat &&
  p.lng >= PAKISTAN_BOUNDS.minLng &&
  p.lng <= PAKISTAN_BOUNDS.maxLng

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

  const [text, setText] = useState('')
  const [place, setPlace] = useState('')
  const [point, setPoint] = useState<Point | null>(null)
  const [image, setImage] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  const [errors, setErrors] = useState<{
    text?: string
    place?: string
    image?: string
    form?: string
  }>({})

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

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (textError) return
    if (place.length > 200) {
      setErrors({ place: 'Keep the place under 200 characters.' })
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
    if (demoMode) form.set('is_synthetic', 'true')

    setErrors({})
    submit.mutate(form, {
      onSuccess: (res) => navigate(`/submit/done/${encodeURIComponent(res.reference)}`),
      onError: (err) => {
        if (!(err instanceof ApiError))
          return setErrors({ form: 'Something went wrong. Try again.' })
        if (err.status === 413 || err.status === 415) return setErrors({ image: err.message })
        if (err.status === 429)
          return setErrors({
            form: 'Too many reports from this connection. Try again in a minute.',
          })
        if (err.status === 400) {
          const field = String(err.details.field ?? '')
          if (field === 'place_text') return setErrors({ place: err.message })
          if (field === 'image') return setErrors({ image: err.message })
          if (field === 'lat' || field === 'lng') return setErrors({ form: err.message })
          return setErrors({ text: err.message })
        }
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
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10">
      <h1 className="text-3xl font-bold tracking-tight">Submit a report</h1>
      <p className="mt-2 text-muted">
        Tell us what is happening and what is needed — in Urdu, Roman Urdu or English. A reviewer
        checks every report before anything appears on the public map.
      </p>

      <form onSubmit={onSubmit} noValidate className="card mt-6 flex flex-col gap-6 p-5 sm:p-6">
        <div>
          <label htmlFor="report-text" className="label">
            What is happening and what is needed?
          </label>
          <textarea
            id="report-text"
            dir="auto"
            rows={6}
            className="input resize-y leading-relaxed"
            placeholder="Misal: Hamare gaon mein pani aa gaya hai, 5 bachay hain, dawai chahiye. / Example: Water has entered our village, we need medicine."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showTextError ? true : undefined}
            aria-describedby="report-text-help"
          />
          <div id="report-text-help" className="mt-1 flex justify-between gap-3 text-sm">
            <span className={showTextError ? 'text-rejected' : 'text-muted'}>
              {showTextError || 'Between 10 and 2,000 characters.'}
            </span>
            <span className={length > MAX ? 'text-rejected' : 'text-muted'} aria-hidden="true">
              {length.toLocaleString()} / {MAX.toLocaleString()}
            </span>
          </div>
        </div>

        <div>
          <label htmlFor="report-place" className="label">
            Where? <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="report-place"
            dir="auto"
            className="input"
            value={place}
            maxLength={200}
            onChange={(e) => setPlace(e.target.value)}
            aria-describedby="report-place-help"
            aria-invalid={errors.place ? true : undefined}
          />
          <p
            id="report-place-help"
            className={`mt-1 text-sm ${errors.place ? 'text-rejected' : 'text-muted'}`}
          >
            {errors.place ?? 'Village, area or landmark'}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="btn" onClick={() => setPickerOpen(true)}>
              <MapPin size={16} aria-hidden="true" /> {point ? 'Change pin' : 'Or pick on the map'}
            </button>
            {point && (
              <span className="text-sm">
                Pin at {formatCoords(point.lat, point.lng)}{' '}
                <button
                  type="button"
                  className="link -my-3 ml-1 inline-flex min-h-11 items-center px-1"
                  onClick={() => setPoint(null)}
                >
                  Remove
                </button>
              </span>
            )}
          </div>
        </div>

        <div>
          <span className="label" id="photo-label">
            Photo <span className="font-normal text-muted">(optional)</span>
          </span>
          {image && preview ? (
            <div className="flex items-center gap-4">
              <img
                src={preview}
                alt="Selected photo preview"
                className="h-24 w-24 rounded-lg border border-border object-cover"
              />
              <div className="text-sm">
                <p className="max-w-56 truncate font-medium">{image.name}</p>
                <button type="button" className="btn btn-sm mt-2" onClick={removeImage}>
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </button>
              </div>
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
          <p
            id="photo-help"
            className={`mt-1 text-sm ${errors.image ? 'text-rejected' : 'text-muted'}`}
            role={errors.image ? 'alert' : undefined}
          >
            {errors.image ??
              'JPG, PNG or WebP up to 5 MB. Only reviewers can see photos. Location data in the photo is removed.'}
          </p>
        </div>

        {demoMode && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked disabled className="h-5 w-5 accent-[var(--primary)]" />
            This is a test/demo report
          </label>
        )}

        <Callout tone="info" icon={<Lock size={16} aria-hidden="true" />}>
          Don't include ID numbers. Phone numbers are hidden from the public.
        </Callout>

        {errors.form && (
          <p role="alert" className="text-sm font-medium text-rejected">
            {errors.form}
          </p>
        )}

        <button
          type="submit"
          className="btn btn-primary self-stretch sm:self-start"
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
      </form>

      {pickerOpen && (
        <PinPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initial={point}
          onSave={(p) => {
            setPoint(p)
            setPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}
