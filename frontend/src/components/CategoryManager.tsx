import { Pencil, Plus, Tag } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useCategories, useCreateCategory, usePatchCategory } from '../api/hooks'
import type { Category } from '../api/types'
import { needMeta } from '../lib/meta'
import { useToast } from './Toast'
import { Skeleton, errorMessage } from './ui'

const splitKeywords = (s: string) =>
  s
    .split(/[,،\n]/)
    .map((w) => w.trim())
    .filter(Boolean)

function CategoryForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Category
  submitLabel: string
  busy: boolean
  onSubmit: (v: { label: string; label_ur: string; keywords: string[] }) => void
  onCancel?: () => void
}) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [labelUr, setLabelUr] = useState(initial?.label_ur ?? '')
  const [keywords, setKeywords] = useState((initial?.keywords ?? []).join(', '))
  const id = initial?.key ?? 'new'
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (label.trim().length < 2) return
    onSubmit({ label: label.trim(), label_ur: labelUr.trim(), keywords: splitKeywords(keywords) })
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
      <div>
        <label htmlFor={`cat-label-${id}`} className="label">
          Name
        </label>
        <input
          id={`cat-label-${id}`}
          className="input"
          required
          minLength={2}
          maxLength={40}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Blankets"
        />
      </div>
      <div>
        <label htmlFor={`cat-ur-${id}`} className="label">
          Urdu name <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={`cat-ur-${id}`}
          className="input urdu"
          dir="rtl"
          lang="ur"
          maxLength={40}
          value={labelUr}
          onChange={(e) => setLabelUr(e.target.value)}
          placeholder="کمبل"
        />
      </div>
      <div>
        <label htmlFor={`cat-kw-${id}`} className="label">
          Words people use <span className="font-normal text-muted">(comma-separated)</span>
        </label>
        <input
          id={`cat-kw-${id}`}
          className="input"
          dir="auto"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="kambal, razai, blanket, کمبل"
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm min-h-11" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-sm min-h-11" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

/** Organizer-managed help categories (dashboard). New categories are used by the AI for
 * reports that arrive from now on; turned-off ones stop being suggested. */
export function CategoryManager() {
  const list = useCategories(true)
  const create = useCreateCategory()
  const patch = usePatchCategory()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const items = list.data?.items ?? []

  return (
    <section aria-labelledby="cat-h" className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cat-h" className="font-semibold">
            Help categories
          </h2>
          <p className="text-sm text-muted">
            Add the kinds of help your team handles. The AI uses active categories for new reports;
            the words you list help it recognise them in Roman Urdu, Urdu or English.
          </p>
        </div>
        {!adding && (
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden="true" /> Add category
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <CategoryForm
            submitLabel="Add"
            busy={create.isPending}
            onCancel={() => setAdding(false)}
            onSubmit={(v) =>
              create.mutate(
                { label: v.label, label_ur: v.label_ur || undefined, keywords: v.keywords },
                {
                  onSuccess: (c) => {
                    toast(`Category "${c.label}" added.`)
                    setAdding(false)
                  },
                  onError: (err) => toast(errorMessage(err, "Couldn't add the category."), 'error'),
                },
              )
            }
          />
        </div>
      )}

      {list.isPending ? (
        <Skeleton className="h-40" />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((c) => {
            const m = needMeta(c.key, items)
            const Icon = c.builtin ? m.icon : Tag
            return (
              <li key={c.key} className="flex flex-col gap-2 py-3">
                {editing === c.key ? (
                  <CategoryForm
                    initial={c}
                    submitLabel="Save"
                    busy={patch.isPending}
                    onCancel={() => setEditing(null)}
                    onSubmit={(v) =>
                      patch.mutate(
                        {
                          key: c.key,
                          label: v.label,
                          label_ur: v.label_ur || null,
                          keywords: v.keywords,
                        },
                        {
                          onSuccess: () => {
                            toast('Category saved.')
                            setEditing(null)
                          },
                          onError: (err) => toast(errorMessage(err, "Couldn't save."), 'error'),
                        },
                      )
                    }
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <Icon size={16} aria-hidden="true" style={{ color: m.color }} />
                    <span className={`font-medium ${c.active ? '' : 'text-muted line-through'}`}>
                      {c.label}
                    </span>
                    {c.label_ur && (
                      <span lang="ur" dir="rtl" className="urdu text-muted">
                        {c.label_ur}
                      </span>
                    )}
                    {c.builtin && (
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
                        Built-in
                      </span>
                    )}
                    <span className="flex flex-1 flex-wrap gap-1">
                      {c.keywords.map((k) => (
                        <span
                          key={k}
                          dir="auto"
                          className="rounded-full border border-border px-2 text-xs"
                        >
                          {k}
                        </span>
                      ))}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditing(c.key)}
                      aria-label={`Edit ${c.label}`}
                    >
                      <Pencil size={14} aria-hidden="true" /> Edit
                    </button>
                    {c.key !== 'other' && (
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--primary)]"
                          checked={c.active}
                          disabled={patch.isPending}
                          onChange={(e) =>
                            patch.mutate(
                              { key: c.key, active: e.target.checked },
                              {
                                onSuccess: (u) =>
                                  toast(`"${u.label}" ${u.active ? 'turned on' : 'turned off'}.`),
                                onError: (err) =>
                                  toast(errorMessage(err, "Couldn't update."), 'error'),
                              },
                            )
                          }
                        />
                        Active
                      </label>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
