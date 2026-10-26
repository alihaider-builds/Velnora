import { Pencil, PhoneCall, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAllHelplines, useCreateHelpline, usePatchHelpline } from '../api/hooks'
import type { Helpline } from '../api/types'
import { formatPhone } from '../lib/format'
import { useToast } from './Toast'
import { Skeleton, errorMessage } from './ui'

const PHONE = /^[+0-9][0-9 ()-]{6,24}$/

function HelplineForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Helpline
  submitLabel: string
  busy: boolean
  onSubmit: (v: { number: string; label: string; provider_number: string }) => void
  onCancel: () => void
}) {
  const [number, setNumber] = useState(initial?.number ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [provider, setProvider] = useState(initial?.provider_number ?? '')
  const [error, setError] = useState<string | null>(null)
  const id = initial?.id ?? 'new'
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!initial && !PHONE.test(number.trim()))
      return setError('Enter a phone number, e.g. 0300 1234567.')
    if (provider.trim() && !PHONE.test(provider.trim()))
      return setError('The forwarding number must be a phone number.')
    if (label.trim().length < 2) return setError('Give the helpline a name.')
    setError(null)
    onSubmit({ number: number.trim(), label: label.trim(), provider_number: provider.trim() })
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`hl-number-${id}`} className="label">
            Helpline number
          </label>
          <input
            id={`hl-number-${id}`}
            className="input"
            inputMode="tel"
            dir="ltr"
            value={number}
            disabled={!!initial}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="+92 300 1234567"
          />
        </div>
        <div>
          <label htmlFor={`hl-label-${id}`} className="label">
            Name
          </label>
          <input
            id={`hl-label-${id}`}
            className="input"
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Rawalpindi flood helpline"
          />
        </div>
        <div>
          <label htmlFor={`hl-provider-${id}`} className="label">
            Forwards to <span className="font-normal text-muted">(Twilio number)</span>
          </label>
          <input
            id={`hl-provider-${id}`}
            className="input"
            inputMode="tel"
            dir="ltr"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="+1 555 010 0199"
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-rejected">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button type="button" className="btn btn-sm min-h-11" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** Organizer-managed helpline numbers (dashboard). Calls to these numbers are recorded,
 * transcribed and put in the review queue. */
export function HelplineManager() {
  const list = useAllHelplines()
  const create = useCreateHelpline()
  const patch = usePatchHelpline()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const items = list.data?.items ?? []

  return (
    <section aria-labelledby="hl-h" className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="hl-h" className="font-semibold">
            Helpline numbers
          </h2>
          <p className="max-w-3xl text-sm text-muted">
            Calls to these numbers are recorded, turned into text and added to the review queue. An
            ordinary mobile number works by forwarding its calls to your Twilio number: put that
            number in "Forwards to". Active numbers are shown on the public pages.
          </p>
        </div>
        {!adding && (
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden="true" /> Add helpline
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <HelplineForm
            submitLabel="Add"
            busy={create.isPending}
            onCancel={() => setAdding(false)}
            onSubmit={(v) =>
              create.mutate(
                {
                  number: v.number,
                  label: v.label,
                  provider_number: v.provider_number || undefined,
                },
                {
                  onSuccess: (h) => {
                    toast(`Helpline "${h.label}" added.`)
                    setAdding(false)
                  },
                  onError: (err) => toast(errorMessage(err, "Couldn't add the helpline."), 'error'),
                },
              )
            }
          />
        </div>
      )}

      {list.isPending ? (
        <Skeleton className="h-20" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No helpline numbers yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((h) => (
            <li key={h.id} className="py-3">
              {editing === h.id ? (
                <HelplineForm
                  initial={h}
                  submitLabel="Save"
                  busy={patch.isPending}
                  onCancel={() => setEditing(null)}
                  onSubmit={(v) =>
                    patch.mutate(
                      { id: h.id, label: v.label, provider_number: v.provider_number || null },
                      {
                        onSuccess: () => {
                          toast('Helpline saved.')
                          setEditing(null)
                        },
                        onError: (err) => toast(errorMessage(err, "Couldn't save."), 'error'),
                      },
                    )
                  }
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <PhoneCall size={16} aria-hidden="true" className="text-primary" />
                  <span className={`font-medium ${h.active ? '' : 'text-muted line-through'}`}>
                    {h.label}
                  </span>
                  <span dir="ltr" className="font-mono text-sm">
                    {formatPhone(h.number)}
                  </span>
                  <span className="flex-1 text-xs text-muted">
                    {h.provider_number
                      ? `Forwards to ${formatPhone(h.provider_number)}`
                      : 'Calls arrive on this number directly'}
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(h.id)}>
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={patch.isPending}
                    onClick={() =>
                      patch.mutate(
                        { id: h.id, active: !h.active },
                        {
                          onSuccess: (r) =>
                            toast(r.active ? 'Helpline turned on.' : 'Helpline turned off.'),
                          onError: (err) => toast(errorMessage(err, "Couldn't save."), 'error'),
                        },
                      )
                    }
                  >
                    {h.active ? 'Turn off' : 'Turn on'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
