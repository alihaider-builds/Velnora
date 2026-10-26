import {
  AlertTriangle,
  BadgeCheck,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { useState, type FormEvent, type MutableRefObject, type ReactNode } from 'react'
import { useNeeds, usePatchFields, useRetryExtraction } from '../api/hooks'
import type {
  Evidence,
  Extraction,
  NeedCategory,
  Report,
  ReviewerFields,
  ReviewerQuantity,
} from '../api/types'
import { needMeta } from '../lib/meta'
import { AiBadge, NeedChip } from './badges'
import { FieldCard } from './FieldCard'
import { useToast } from './Toast'
import { Skeleton, Spinner, errorMessage } from './ui'
import { UserText } from './UserText'

export interface EvidenceField {
  key: string
  /** Card heading, e.g. "Need". */
  label: string
  /** Name used for the evidence mark, e.g. "Medicine". */
  name: string
  value: string
  evidence: Evidence
}

/** Every AI field that carries evidence, in display order. Keys drive highlighting. */
// eslint-disable-next-line react-refresh/only-export-components
export function evidenceFields(
  ex: Extraction,
  needLabel: (key: NeedCategory) => string = (k) => needMeta(k).en,
): EvidenceField[] {
  const out: EvidenceField[] = []
  ex.needs.forEach((n, i) =>
    out.push({
      key: `need-${i}`,
      label: 'Need',
      name: needLabel(n.category),
      value: needLabel(n.category),
      evidence: n.evidence,
    }),
  )
  ex.quantities.forEach((q, i) =>
    out.push({
      key: `qty-${i}`,
      label: 'Quantity',
      name: `${q.value} ${q.label}`,
      value: `${q.value} ${q.label}`,
      evidence: q.evidence,
    }),
  )
  if (ex.place_name)
    out.push({
      key: 'place',
      label: 'Place',
      name: ex.place_name.text,
      value: ex.place_name.text,
      evidence: ex.place_name.evidence,
    })
  if (ex.time_reference)
    out.push({
      key: 'time',
      label: 'Time',
      name: ex.time_reference.text,
      value: ex.time_reference.text,
      evidence: ex.time_reference.evidence,
    })
  return out
}

const isFake = (model: string) => /fake/i.test(model)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

type FieldKey = keyof ReviewerFields

const FIELD_NAME: Record<FieldKey, string> = {
  needs: 'Needs',
  quantities: 'Quantities',
  place_name: 'Place',
  time_reference: 'Time',
}

function VerifiedCard({
  label,
  children,
  aiSaid,
  onReset,
  resetting,
}: {
  label: string
  children: ReactNode
  aiSaid: string
  onReset: () => void
  resetting: boolean
}) {
  return (
    <div className="rounded-lg border-[1.5px] border-verified bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-verified-ink">
          <BadgeCheck size={13} aria-hidden="true" /> Verified by reviewer
        </span>
      </div>
      <div className="mt-1 font-semibold">{children}</div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">AI said: {aiSaid || '—'}</p>
        <button
          type="button"
          className="btn btn-ghost btn-sm -mr-2 text-xs"
          disabled={resetting}
          onClick={onReset}
          aria-label={`Use the AI value for ${label.toLowerCase()}`}
        >
          <RotateCcw size={13} aria-hidden="true" /> Use AI value
        </button>
      </div>
    </div>
  )
}

function EditFieldsForm({
  report,
  blank,
  onDone,
}: {
  report: Report
  blank: boolean
  onDone: () => void
}) {
  const ex = report.extraction
  const rf = report.reviewer_fields
  const { meta, order } = useNeeds()
  const toast = useToast()
  const patch = usePatchFields(report.id)

  const aiNeeds = ex.needs.map((n) => n.category)
  const aiQty: ReviewerQuantity[] = ex.quantities.map((q) => ({ value: q.value, label: q.label }))
  const aiPlace = ex.place_name?.text ?? ''
  const aiTime = ex.time_reference?.text ?? ''

  // What the screen currently shows for each field (correction if any, else AI value).
  const current = {
    needs: rf.needs ?? aiNeeds,
    quantities: rf.quantities ?? aiQty,
    place_name: rf.place_name ?? aiPlace,
    time_reference: rf.time_reference ?? aiTime,
  }

  const [needs, setNeeds] = useState<NeedCategory[]>(blank ? [] : current.needs)
  const [qty, setQty] = useState<ReviewerQuantity[]>(blank ? [] : current.quantities)
  const [place, setPlace] = useState(blank ? '' : current.place_name)
  const [time, setTime] = useState(blank ? '' : current.time_reference)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const cleanQty = qty
      .filter((q) => q.label.trim() && Number.isFinite(q.value))
      .map((q) => ({ value: q.value, label: q.label.trim() }))
    const next = {
      needs,
      quantities: cleanQty,
      place_name: place.trim(),
      time_reference: time.trim(),
    }
    const ai = { needs: aiNeeds, quantities: aiQty, place_name: aiPlace, time_reference: aiTime }

    // Send only fields the reviewer changed (PATCH is partial), so untouched corrections are
    // never overwritten. A field edited back to the AI value is sent as null = "use the AI value".
    const body: Partial<ReviewerFields> = {}
    for (const key of Object.keys(next) as FieldKey[]) {
      if (same(next[key], current[key])) continue
      Object.assign(body, { [key]: same(next[key], ai[key]) ? null : next[key] })
    }
    if (Object.keys(body).length === 0) {
      toast('No changes to save.')
      onDone()
      return
    }

    patch.mutate(body, {
      onSuccess: () => {
        toast('Fields saved. The original report and AI suggestions are unchanged.')
        onDone()
      },
      onError: (err) => toast(errorMessage(err, "Couldn't save the fields."), 'error'),
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-3"
    >
      <fieldset>
        <legend className="label">Needs</legend>
        <div className="flex flex-wrap gap-2">
          {[...order, ...needs.filter((n) => !order.includes(n))].map((n) => {
            const on = needs.includes(n)
            const m = meta(n)
            const Icon = m.icon
            return (
              <label
                key={n}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm ${
                  on
                    ? 'border-primary bg-surface font-semibold text-primary'
                    : 'border-border bg-surface'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() =>
                    setNeeds((cur) => (on ? cur.filter((x) => x !== n) : [...cur, n]))
                  }
                />
                <Icon size={14} aria-hidden="true" style={{ color: m.color }} />
                {m.en}
              </label>
            )
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="label">Quantities</legend>
        <div className="flex flex-col gap-2">
          {qty.map((q, i) => (
            <div key={i} className="flex gap-2">
              <label className="sr-only" htmlFor={`qty-v-${i}`}>
                Quantity {i + 1} value
              </label>
              <input
                id={`qty-v-${i}`}
                type="number"
                min={0}
                className="input w-24"
                value={Number.isFinite(q.value) ? q.value : ''}
                onChange={(e) =>
                  setQty((cur) =>
                    cur.map((x, j) => (j === i ? { ...x, value: e.target.valueAsNumber } : x)),
                  )
                }
              />
              <label className="sr-only" htmlFor={`qty-l-${i}`}>
                Quantity {i + 1} label
              </label>
              <input
                id={`qty-l-${i}`}
                className="input flex-1"
                placeholder="children, families…"
                value={q.label}
                onChange={(e) =>
                  setQty((cur) =>
                    cur.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                  )
                }
              />
              <button
                type="button"
                className="btn btn-ghost px-3"
                aria-label={`Remove quantity ${i + 1}`}
                onClick={() => setQty((cur) => cur.filter((_, j) => j !== i))}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-sm self-start"
            onClick={() => setQty((cur) => [...cur, { value: 1, label: '' }])}
          >
            <Plus size={14} aria-hidden="true" /> Add quantity
          </button>
        </div>
      </fieldset>

      <div>
        <label htmlFor="edit-place" className="label">
          Place
        </label>
        <input
          id="edit-place"
          dir="auto"
          className="input"
          value={place}
          maxLength={200}
          onChange={(e) => setPlace(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="edit-time" className="label">
          Time
        </label>
        <input
          id="edit-time"
          dir="auto"
          className="input"
          value={time}
          maxLength={200}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn" onClick={onDone}>
          <X size={15} aria-hidden="true" /> Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={patch.isPending}>
          {patch.isPending ? <Spinner label="Saving…" /> : 'Save fields'}
        </button>
      </div>
    </form>
  )
}

export function AiSuggestions({
  report,
  activeKey,
  pinnedKey,
  onPreview,
  onPin,
  cardRefs,
  editing,
  setEditing,
  stalled,
  onRetryPoll,
}: {
  report: Report
  activeKey: string | null
  pinnedKey: string | null
  onPreview: (key: string | null) => void
  onPin: (key: string) => void
  cardRefs: MutableRefObject<(HTMLButtonElement | null)[]>
  editing: false | 'edit' | 'blank'
  setEditing: (v: false | 'edit' | 'blank') => void
  stalled: boolean
  onRetryPoll: () => void
}) {
  const ex = report.extraction
  const rf = report.reviewer_fields
  const { meta } = useNeeds()
  const retry = useRetryExtraction(report.id)
  const patch = usePatchFields(report.id)
  const toast = useToast()
  const fields = evidenceFields(ex, (k) => meta(k).en)
  const hasCorrections =
    rf.needs !== null ||
    rf.quantities !== null ||
    rf.place_name !== null ||
    rf.time_reference !== null
  let shortcut = 0

  /** Clears one correction (null = "use the AI value", §4.3). The backend records it in the audit. */
  const resetField = (key: FieldKey) =>
    patch.mutate({ [key]: null } as Partial<ReviewerFields>, {
      onSuccess: () => toast(`${FIELD_NAME[key]}: back to the AI suggestion.`),
      onError: (err) => toast(errorMessage(err, "Couldn't reset the field."), 'error'),
    })
  const resetting = (key: FieldKey) =>
    patch.isPending && patch.variables !== undefined && key in patch.variables

  const card = (f: EvidenceField) => {
    const index = shortcut++
    return (
      <FieldCard
        key={f.key}
        ref={(el) => {
          cardRefs.current[index] = el
        }}
        label={f.label}
        value={<UserText text={f.value} />}
        evidence={f.evidence}
        shortcut={index + 1}
        active={activeKey === f.key}
        pinned={pinnedKey === f.key}
        onPreview={(on) => onPreview(on ? f.key : null)}
        onPin={() => onPin(f.key)}
      />
    )
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <span className="text-xs font-semibold text-muted">2</span>
        <AiBadge />
        AI suggestions <span className="font-normal text-muted">(Gemma 4)</span>
      </h2>
      {ex.status === 'succeeded' && isFake(ex.model) && (
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
          Pre-generated example
        </span>
      )}
    </div>
  )

  if (ex.status === 'pending' || ex.status === 'running') {
    return (
      <section aria-labelledby="ai-h" className="flex flex-col gap-3" aria-busy={!stalled}>
        <span id="ai-h" className="sr-only">
          AI suggestions
        </span>
        {header}
        {stalled ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded-lg border border-border p-3 text-sm"
          >
            <p>Gemma is still reading after 2 minutes.</p>
            <button type="button" className="btn btn-sm" onClick={onRetryPoll}>
              <RotateCw size={14} aria-hidden="true" /> Check again
            </button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-ai" role="status">
            <Sparkles size={15} aria-hidden="true" className="animate-pulse" /> Gemma is reading the
            report…
          </p>
        )}
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-12" />
      </section>
    )
  }

  if (ex.status === 'failed' && !editing) {
    return (
      <section aria-labelledby="ai-h" className="flex flex-col gap-3">
        <span id="ai-h" className="sr-only">
          AI suggestions
        </span>
        {header}
        <div role="alert" className="rounded-lg border border-rejected/50 p-3">
          <p className="flex items-center gap-2 font-semibold text-rejected">
            <AlertTriangle size={16} aria-hidden="true" /> Extraction failed
          </p>
          {ex.error && <p className="mt-1 text-sm text-muted">{ex.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate(undefined, {
                  onError: (err) => toast(errorMessage(err, "Couldn't retry extraction."), 'error'),
                })
              }
            >
              <RotateCw size={14} aria-hidden="true" /> Retry extraction
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setEditing('blank')}>
              <Pencil size={14} aria-hidden="true" /> Fill in manually
            </button>
          </div>
        </div>
        {hasCorrections && fieldList()}
      </section>
    )
  }

  return (
    <section aria-labelledby="ai-h" className="flex flex-col gap-3">
      <span id="ai-h" className="sr-only">
        AI suggestions
      </span>
      {header}
      <p className="text-sm text-muted">
        Check before approving. Click a suggestion to see the words it came from.
      </p>

      {editing ? (
        <EditFieldsForm
          report={report}
          blank={editing === 'blank'}
          onDone={() => setEditing(false)}
        />
      ) : (
        fieldList()
      )}
    </section>
  )

  function fieldList() {
    const needFields = fields.filter((f) => f.key.startsWith('need'))
    const qtyFields = fields.filter((f) => f.key.startsWith('qty'))
    const placeField = fields.find((f) => f.key === 'place')
    const timeField = fields.find((f) => f.key === 'time')
    const aiNeedsText = needFields.map((f) => f.value).join(', ')

    return (
      <>
        {rf.needs !== null ? (
          <VerifiedCard
            label="Needs"
            aiSaid={aiNeedsText}
            onReset={() => resetField('needs')}
            resetting={resetting('needs')}
          >
            <span className="flex flex-wrap gap-1.5">
              {rf.needs.length ? rf.needs.map((n) => <NeedChip key={n} need={n} />) : 'None'}
            </span>
          </VerifiedCard>
        ) : (
          needFields.map(card)
        )}

        {rf.quantities !== null ? (
          <VerifiedCard
            label="Quantities"
            aiSaid={qtyFields.map((f) => f.value).join(', ')}
            onReset={() => resetField('quantities')}
            resetting={resetting('quantities')}
          >
            {rf.quantities.length
              ? rf.quantities.map((q) => `${q.value} ${q.label}`).join(', ')
              : 'None'}
          </VerifiedCard>
        ) : (
          qtyFields.map(card)
        )}

        {rf.place_name !== null ? (
          <VerifiedCard
            label="Place"
            aiSaid={placeField?.value ?? ''}
            onReset={() => resetField('place_name')}
            resetting={resetting('place_name')}
          >
            <UserText text={rf.place_name || 'None'} />
          </VerifiedCard>
        ) : placeField ? (
          card(placeField)
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted">
            Place: not stated
          </p>
        )}

        {rf.time_reference !== null ? (
          <VerifiedCard
            label="Time"
            aiSaid={timeField?.value ?? ''}
            onReset={() => resetField('time_reference')}
            resetting={resetting('time_reference')}
          >
            <UserText text={rf.time_reference || 'None'} />
          </VerifiedCard>
        ) : timeField ? (
          card(timeField)
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted">
            Time: —
          </p>
        )}

        {ex.uncertainties.length > 0 && (
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <AlertTriangle size={15} aria-hidden="true" className="text-flagged" /> Uncertainties
            </p>
            <ul className="mt-1 flex flex-col gap-0.5 text-sm">
              {ex.uncertainties.map((u) => (
                <li key={u} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  <UserText text={u} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <button type="button" className="btn btn-sm self-start" onClick={() => setEditing('edit')}>
          <Pencil size={14} aria-hidden="true" /> Edit fields <kbd aria-hidden="true">E</kbd>
        </button>
      </>
    )
  }
}
