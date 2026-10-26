import { describe, expect, it } from 'vitest'
import { DEMO_SENTENCE } from '../lib/demo'
import { evidence, maskText } from './engine'
import { seedRecords } from './fixtures'

describe('mock fixtures follow the contract', () => {
  it('computes demo evidence offsets in code points (UI_UX_SPEC §9 table)', () => {
    expect(evidence(DEMO_SENTENCE, 'Buner')).toMatchObject({ start: 0, end: 5, matched: true })
    expect(evidence(DEMO_SENTENCE, '5 bachay')).toMatchObject({ start: 35, end: 43 })
    expect(evidence(DEMO_SENTENCE, 'dawai')).toMatchObject({ start: 50, end: 55 })
    expect(evidence(DEMO_SENTENCE, 'saaf pani')).toMatchObject({ start: 60, end: 69 })
    expect(evidence(DEMO_SENTENCE, 'not there')).toEqual({
      phrase: 'not there',
      start: null,
      end: null,
      matched: false,
    })
  })

  it('masks phone numbers with same-length replacement (BACKEND_TECH_SPEC §8)', () => {
    const text = 'Rabta 0312-3456789 please'
    const masked = maskText(text)
    expect(masked).toBe('Rabta 03••-••••••• please')
    expect(Array.from(masked)).toHaveLength(Array.from(text).length)
  })

  it('covers every fixture case required by UI_UX_SPEC §9', () => {
    const reports = seedRecords().map((r) => r.report)
    expect(reports.some((r) => r.extraction.language === 'urdu')).toBe(true)
    expect(
      reports.some(
        (r) =>
          r.extraction.needs.some((n) => !n.evidence.matched) ||
          r.extraction.time_reference?.evidence.matched === false,
      ),
    ).toBe(true)
    expect(reports.some((r) => r.extraction.status === 'pending')).toBe(true)
    expect(reports.some((r) => r.extraction.status === 'failed')).toBe(true)
    expect(new Set(reports.map((r) => r.channel))).toEqual(new Set(['web', 'sms', 'whatsapp']))
    expect(reports.some((r) => /ignore previous instructions/i.test(r.source_text))).toBe(true)
  })
})
