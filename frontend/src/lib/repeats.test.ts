import { describe, expect, it } from 'vitest'
import { collapseRepeats } from './repeats'

describe('collapseRepeats', () => {
  it('collapses a stuck word or phrase', () => {
    expect(collapseRepeats('پھلود پر پر پر پر پر پر')).toBe('پھلود پر')
    expect(collapseRepeats('we need food we need food we need food now')).toBe('we need food now')
  })
  it('keeps normal speech and genuine doubling', () => {
    const text = 'Saddar mein pani pani hai, jaldi jaldi madad chahiye'
    expect(collapseRepeats(text)).toBe(text)
  })
})
