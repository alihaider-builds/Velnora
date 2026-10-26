import { BadgeCheck, MapPin, MapPinned, Search } from 'lucide-react'
import { useMemo, useState, type FormEvent, type RefObject } from 'react'
import { ApiError } from '../api/client'
import { useConfirmLocation, useGeocode } from '../api/hooks'
import type { ConfirmLocationRequest, Report } from '../api/types'
import { PAKISTAN_CENTER } from '../lib/config'
import { formatCoords } from '../lib/format'
import { CoordinateInput } from './CoordinateInput'
import { MapView, type MapMarker } from './MapView'
import { useToast } from './Toast'
import { Spinner, errorMessage } from './ui'
import { UserText } from './UserText'

type Choice = ConfirmLocationRequest

const REVIEWER_PIN_LABEL = 'Reviewer-provided location'

/** Column 3 of the report screen (UI_UX_SPEC §5.5). */
export function LocationPicker({
  report,
  searchRef,
}: {
  report: Report
  searchRef: RefObject<HTMLInputElement>
}) {
  const loc = report.location
  const toast = useToast()
  const confirm = useConfirmLocation(report.id)
  const placeText =
    report.reviewer_fields.place_name ??
    report.extraction.place_name?.text ??
    loc.submitted_text ??
    ''

  const [changing, setChanging] = useState(false)
  const [draftQuery, setDraftQuery] = useState(placeText)
  const [query, setQuery] = useState(placeText)
  const [userSearched, setUserSearched] = useState(false)

  // Extraction can finish after this panel mounts: adopt the new place name for map search
  // unless the reviewer has already searched for something themselves.
  const [seenPlace, setSeenPlace] = useState(placeText)
  if (seenPlace !== placeText) {
    setSeenPlace(placeText)
    if (!userSearched) {
      setDraftQuery(placeText)
      setQuery(placeText)
    }
  }
  const [choice, setChoice] = useState<Choice | null>(
    loc.suggested
      ? {
          lat: loc.suggested.lat,
          lng: loc.suggested.lng,
          label: loc.suggested.label,
          source: 'geocoder_candidate',
        }
      : null,
  )
  const geocode = useGeocode(query)
  const candidates = useMemo(() => geocode.data?.candidates ?? [], [geocode.data])

  // Pre-select the best candidate once results arrive, unless the reviewer already chose.
  const [autoPicked, setAutoPicked] = useState(false)
  if (!autoPicked && !choice && candidates.length > 0) {
    setAutoPicked(true)
    const c = candidates[0]
    setChoice({ lat: c.lat, lng: c.lng, label: c.label, source: 'geocoder_candidate' })
  }

  const geocoderDown = geocode.error instanceof ApiError && geocode.error.status === 502

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = candidates
      .filter((c) => !(choice && c.lat === choice.lat && c.lng === choice.lng))
      .map((c, i) => ({ id: `c${i}`, lat: c.lat, lng: c.lng, kind: 'candidate', label: c.label }))
    if (loc.submitted_point) {
      out.push({
        id: 'submitter',
        ...loc.submitted_point,
        kind: 'submitter',
        label: "Submitter's pin",
      })
    }
    if (choice)
      out.push({
        id: 'selected',
        lat: choice.lat,
        lng: choice.lng,
        kind: 'selected',
        label: choice.label,
      })
    return out
  }, [candidates, choice, loc.submitted_point])

  const pin = (lat: number, lng: number) =>
    setChoice({ lat, lng, label: query.trim() || REVIEWER_PIN_LABEL, source: 'reviewer_pin' })

  const dropPin = () => {
    const at = choice ??
      loc.suggested ??
      loc.submitted_point ?? { lat: PAKISTAN_CENTER[1], lng: PAKISTAN_CENTER[0] }
    pin(at.lat, at.lng)
  }

  const onSearch = (e: FormEvent) => {
    e.preventDefault()
    setUserSearched(true)
    setQuery(draftQuery)
    setAutoPicked(false)
  }

  const onConfirm = () => {
    if (!choice) return
    confirm.mutate(choice, {
      onSuccess: () => {
        toast(`Location confirmed: ${choice.label}`)
        setChanging(false)
      },
      onError: (err) => toast(errorMessage(err, "Couldn't confirm the location."), 'error'),
    })
  }

  const confirmed = loc.confirmed
  if (confirmed && !changing) {
    const confirmedMarker: MapMarker[] = [
      {
        id: 'confirmed',
        lat: confirmed.lat,
        lng: confirmed.lng,
        kind: 'selected',
        label: confirmed.label,
      },
    ]
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border-[1.5px] border-verified p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-verified-ink">
            <BadgeCheck size={16} aria-hidden="true" /> Location confirmed
          </p>
          <p className="mt-1 font-semibold">
            <UserText text={confirmed.label} />
          </p>
          <p className="text-sm text-muted">
            {confirmed.source === 'reviewer_pin' ? REVIEWER_PIN_LABEL : 'Map search result'} ·{' '}
            {formatCoords(confirmed.lat, confirmed.lng)}
          </p>
          <button type="button" className="btn btn-sm mt-2" onClick={() => setChanging(true)}>
            Change
          </button>
        </div>
        <MapView
          label="Confirmed location"
          className="h-44"
          markers={confirmedMarker}
          focus={{ ...confirmed, zoom: 11 }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSearch} className="flex gap-2" role="search">
        <label htmlFor="loc-search" className="sr-only">
          Search the map for a place
        </label>
        <input
          id="loc-search"
          ref={searchRef}
          dir="auto"
          className="input"
          placeholder="Village, area or landmark"
          value={draftQuery}
          onChange={(e) => setDraftQuery(e.target.value)}
        />
        <button type="submit" className="btn shrink-0" disabled={draftQuery.trim().length < 2}>
          <Search size={15} aria-hidden="true" /> Search again
        </button>
      </form>

      {geocoderDown && (
        <p role="alert" className="text-sm font-medium text-flagged">
          Map search is unavailable — drop a pin on the map instead.
        </p>
      )}

      <fieldset>
        <legend className="sr-only">Location candidates</legend>
        {geocode.isFetching && <Spinner label="Searching the map…" />}
        {!geocode.isFetching &&
          query.trim().length >= 2 &&
          !geocoderDown &&
          candidates.length === 0 &&
          geocode.isSuccess && (
            <p className="text-sm text-muted">No matches. Search again or drop a pin.</p>
          )}
        {!query.trim() && (
          <p className="text-sm text-muted">No place name yet. Search for one or drop a pin.</p>
        )}
        <ul className="flex flex-col gap-1">
          {candidates.map((c, i) => {
            const checked =
              choice?.source === 'geocoder_candidate' &&
              choice.lat === c.lat &&
              choice.lng === c.lng
            return (
              <li key={`${c.lat},${c.lng}`}>
                <label
                  className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${
                    checked ? 'border-primary bg-surface-2' : 'border-border'
                  }`}
                >
                  <input
                    type="radio"
                    name="loc-candidate"
                    className="mt-1 accent-[var(--primary)]"
                    checked={checked}
                    onChange={() =>
                      setChoice({
                        lat: c.lat,
                        lng: c.lng,
                        label: c.label,
                        source: 'geocoder_candidate',
                      })
                    }
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium">
                      {c.label}{' '}
                      {i === 0 && (
                        <span className="text-xs font-normal text-muted">(best match)</span>
                      )}
                    </span>
                    <span className="text-xs text-muted capitalize">{c.type}</span>
                  </span>
                </label>
              </li>
            )
          })}
          {choice?.source === 'reviewer_pin' && (
            <li className="flex min-h-11 items-center gap-2 rounded-lg border border-primary bg-surface-2 px-3 py-2 text-sm">
              <MapPinned size={16} aria-hidden="true" className="text-primary" />
              <span>
                <span className="block font-medium">{REVIEWER_PIN_LABEL}</span>
                <span className="text-xs text-muted">
                  {formatCoords(choice.lat, choice.lng)} — drag the pin to adjust
                </span>
              </span>
            </li>
          )}
        </ul>
      </fieldset>

      <MapView
        label="Location map. Click to place a pin; drag the pin to adjust."
        className="h-60"
        markers={markers}
        focus={choice ? { lat: choice.lat, lng: choice.lng, zoom: 10 } : null}
        onPick={pin}
        onDrag={pin}
        onMarkerClick={(id) => {
          const c = candidates[Number(id.slice(1))]
          if (c) setChoice({ lat: c.lat, lng: c.lng, label: c.label, source: 'geocoder_candidate' })
        }}
      />
      {loc.submitted_point && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <span
            className="inline-block h-3 w-3 rounded-full border-2 border-surface bg-pending"
            aria-hidden="true"
          />{' '}
          Submitter's pin
        </p>
      )}

      <CoordinateInput onSet={pin} />

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" onClick={dropPin}>
          <MapPin size={14} aria-hidden="true" /> Drop pin
        </button>
        {changing && (
          <button type="button" className="btn btn-sm" onClick={() => setChanging(false)}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm ml-auto"
          disabled={!choice || confirm.isPending}
          onClick={onConfirm}
        >
          {confirm.isPending ? <Spinner label="Confirming…" /> : 'Confirm location'}
        </button>
      </div>
    </div>
  )
}
