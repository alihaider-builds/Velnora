import { Loader2, MapPin } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { usePlaceSuggestions } from '../api/hooks'
import type { PlaceSuggestion } from '../api/types'

const DEBOUNCE_MS = 300

/** Text input with Google Maps–style place suggestions as you type (Pakistan only).
 * Typing freely still works; picking a suggestion fills the name and, when the provider
 * gives coordinates, a pin. */
export function PlaceAutocomplete({
  id,
  value,
  onChange,
  onSelect,
  describedBy,
  invalid,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  onSelect: (s: PlaceSuggestion) => void
  describedBy?: string
  invalid?: boolean
}) {
  const listId = useId()
  const [debounced, setDebounced] = useState(value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value])

  const query = usePlaceSuggestions(open ? debounced : '')
  const items = query.data?.items ?? []
  const searched = debounced.trim().length >= 3 && debounced === value
  const noMatches = searched && query.isSuccess && !query.isFetching && items.length === 0
  const failed = searched && query.isError && !query.isFetching
  const show =
    open &&
    value.trim().length >= 3 &&
    (items.length > 0 || query.isFetching || noMatches || failed)

  const pick = (s: PlaceSuggestion) => {
    onSelect(s)
    setOpen(false)
    setActive(-1)
  }

  return (
    <div className="relative">
      <input
        id={id}
        dir="auto"
        className="input"
        value={value}
        maxLength={200}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={show}
        aria-controls={listId}
        aria-activedescendant={show && active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        placeholder="Start typing, e.g. Lalkurti Rawalpindi"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!show) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, items.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && active >= 0 && items[active]) {
            e.preventDefault()
            pick(items[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {show && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Place suggestions"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-border bg-surface py-1 shadow-card"
        >
          {items.map((s, i) => (
            <li
              key={`${s.label}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`flex min-h-11 cursor-pointer items-start gap-2 px-3 py-2 text-sm ${
                i === active ? 'bg-surface-2' : 'hover:bg-surface-2'
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <MapPin size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
              <span>
                <span className="font-medium">{s.name}</span>
                {s.label !== s.name && (
                  <span className="block text-xs text-muted">
                    {s.label.startsWith(`${s.name}, `) ? s.label.slice(s.name.length + 2) : s.label}
                  </span>
                )}
              </span>
            </li>
          ))}
          {query.isFetching && items.length === 0 && (
            <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Searching…
            </li>
          )}
          {noMatches && (
            <li className="px-3 py-2 text-sm text-muted">
              No matching places. Keep your own wording, or pick the spot on the map.
            </li>
          )}
          {failed && (
            <li role="alert" className="px-3 py-2 text-sm text-flagged">
              Place search is unavailable right now. Type the place name, or pick it on the map.
            </li>
          )}
          <li aria-hidden="true" className="px-3 pt-1 text-right text-[11px] text-muted">
            {query.data?.provider === 'google'
              ? 'Suggestions by Google'
              : 'Suggestions © OpenStreetMap contributors'}
          </li>
        </ul>
      )}
    </div>
  )
}
