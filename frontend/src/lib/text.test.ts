import { describe, expect, it } from 'vitest'
import { DEMO_SENTENCE } from './demo'
import { codePoints, hasUrduScript, segmentText, sliceCodePoints } from './text'

describe('code-point text handling', () => {
  it('slices by code point, not UTF-16 unit', () => {
    const text = '🌊 Buner'
    // "🌊" is 2 UTF-16 units but 1 code point.
    expect(text.slice(2, 7)).not.toBe('Buner')
    expect(sliceCodePoints(text, 2, 7)).toBe('Buner')
    expect(codePoints(text)).toHaveLength(7)
  })

  it('matches the demo fixture offsets from UI_UX_SPEC §9', () => {
    expect(sliceCodePoints(DEMO_SENTENCE, 0, 5)).toBe('Buner')
    expect(sliceCodePoints(DEMO_SENTENCE, 35, 43)).toBe('5 bachay')
    expect(sliceCodePoints(DEMO_SENTENCE, 50, 55)).toBe('dawai')
    expect(sliceCodePoints(DEMO_SENTENCE, 60, 69)).toBe('saaf pani')
  })

  it('segments text around a highlight and keeps every character', () => {
    const segs = segmentText(DEMO_SENTENCE, [{ start: 50, end: 55, key: 'm' }])
    expect(segs.map((s) => s.text).join('')).toBe(DEMO_SENTENCE)
    expect(segs.find((s) => s.range)?.text).toBe('dawai')
  })

  it('ignores invalid or overlapping ranges instead of corrupting text', () => {
    const segs = segmentText('abcdef', [
      { start: 4, end: 99, key: 'bad' },
      { start: 1, end: 3, key: 'a' },
      { start: 2, end: 4, key: 'overlap' },
    ])
    expect(segs.map((s) => s.text).join('')).toBe('abcdef')
    expect(segs.filter((s) => s.range).map((s) => s.range?.key)).toEqual(['a'])
  })

  it('detects Urdu script', () => {
    expect(hasUrduScript('بونیر میں پانی')).toBe(true)
    expect(hasUrduScript('Buner mein pani')).toBe(false)
  })
})
