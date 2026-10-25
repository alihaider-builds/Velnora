import type { ReactNode } from 'react'

export interface BarItem {
  key: string
  label: ReactNode
  value: number
  color: string
}

/**
 * Horizontal bars with the value written beside each one, so colour is never the only cue and
 * the numbers stay readable without hovering. Text uses text tokens, not the series colour.
 */
export function BarList({ items, label }: { items: BarItem[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ul aria-label={label} className="flex flex-col gap-2.5">
      {items.map((i) => (
        <li
          key={i.key}
          className="grid grid-cols-[minmax(7rem,auto)_1fr_2.5rem] items-center gap-3 text-sm"
        >
          <span className="truncate">{i.label}</span>
          <span className="h-2.5 rounded-r bg-surface-2" aria-hidden="true">
            <span
              className="block h-full rounded-r"
              title={`${i.value}`}
              style={{
                width: `${(i.value / max) * 100}%`,
                minWidth: i.value ? 4 : 0,
                backgroundColor: i.color,
              }}
            />
          </span>
          <span className="text-right font-semibold tabular-nums">{i.value}</span>
        </li>
      ))}
    </ul>
  )
}
