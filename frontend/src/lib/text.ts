// Arabic (U+0600–U+06FF) and Arabic Supplement (U+0750–U+077F) blocks — UI_UX_SPEC.md §3.5.
const URDU_SCRIPT = /[؀-ۿݐ-ݿ]/

/** True when the text contains Urdu script, so the Nastaliq `urdu` class should be applied. */
export function hasUrduScript(text: string): boolean {
  return URDU_SCRIPT.test(text)
}

/**
 * Evidence offsets are Unicode code points (BACKEND_TECH_SPEC §4.1), so text is always split
 * with Array.from — never String.prototype.slice, which counts UTF-16 units.
 */
export function codePoints(text: string): string[] {
  return Array.from(text)
}

export function sliceCodePoints(text: string, start: number, end?: number): string {
  return codePoints(text).slice(start, end).join('')
}

export interface TextRange {
  start: number
  end: number
  key: string
}

export interface TextSegment {
  text: string
  range: TextRange | null
}

/**
 * Splits text into plain and highlighted segments. Ranges are code-point offsets; invalid or
 * overlapping ranges are skipped so a bad offset can never corrupt the text shown.
 */
export function segmentText(text: string, ranges: TextRange[]): TextSegment[] {
  const cps = codePoints(text)
  const sorted = ranges
    .filter((r) => r.start >= 0 && r.end > r.start && r.end <= cps.length)
    .sort((a, b) => a.start - b.start)

  const out: TextSegment[] = []
  let cursor = 0
  for (const r of sorted) {
    if (r.start < cursor) continue
    if (r.start > cursor) out.push({ text: cps.slice(cursor, r.start).join(''), range: null })
    out.push({ text: cps.slice(r.start, r.end).join(''), range: r })
    cursor = r.end
  }
  if (cursor < cps.length) out.push({ text: cps.slice(cursor).join(''), range: null })
  return out
}
