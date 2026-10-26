import { Crosshair } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { parseCoords } from '../lib/coords'

/** Type coordinates or paste a Google Maps link to place the pin exactly. */
export function CoordinateInput({ onSet }: { onSet: (lat: number, lng: number) => void }) {
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    e.stopPropagation() // may sit inside another form (e.g. the submit page)
    const r = parseCoords(value)
    if ('error' in r) {
      setError(r.error)
      return
    }
    setError(null)
    onSet(r.lat, r.lng)
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        Or enter coordinates / paste a Google Maps link
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          className="input font-mono text-sm"
          dir="ltr"
          inputMode="text"
          placeholder="33.5808, 73.0558"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(e)
          }}
        />
        <button type="button" className="btn btn-sm shrink-0 min-h-11" onClick={submit}>
          <Crosshair size={14} aria-hidden="true" /> Set pin
        </button>
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="text-xs font-medium text-rejected">
          {error}
        </p>
      )}
    </div>
  )
}
