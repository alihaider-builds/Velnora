import { useEffect, useRef } from 'react'
import { hasUrduScript, segmentText } from '../lib/text'
import { prefersReducedMotion } from './MapView'

export interface HighlightRange {
  start: number
  end: number
  /** Accessible name for the <mark>, e.g. "Evidence for Medicine". */
  label: string
}

/**
 * Renders report text with at most one evidence phrase highlighted. Offsets are code points
 * (BACKEND_TECH_SPEC §4.1), so slicing goes through Array.from via `segmentText`.
 */
export function EvidenceText({
  text,
  highlight,
  id,
}: {
  text: string
  highlight: HighlightRange | null
  id?: string
}) {
  const markRef = useRef<HTMLElement>(null)
  const urdu = hasUrduScript(text)
  const segments = segmentText(
    text,
    highlight ? [{ start: highlight.start, end: highlight.end, key: 'active' }] : [],
  )

  useEffect(() => {
    markRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [highlight?.start, highlight?.end])

  return (
    <p
      id={id}
      dir="auto"
      lang={urdu ? 'ur' : undefined}
      className={`whitespace-pre-wrap break-words ${urdu ? 'urdu' : 'text-[17px] leading-relaxed'}`}
    >
      {segments.map((s, i) =>
        s.range ? (
          <mark
            key={i}
            ref={markRef}
            aria-label={highlight?.label}
            className="px-0.5 underline decoration-2 underline-offset-4"
            style={{ textDecorationColor: 'var(--ai)' }}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  )
}
