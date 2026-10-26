import { describe, expect, it } from 'vitest'
import { prepareForRecognition } from './audioPrep'

describe('prepareForRecognition', () => {
  it('removes DC offset and raises a quiet recording to a normal peak', () => {
    const input = new Float32Array([0.11, 0.09, 0.12, 0.08, 0.1])
    const out = prepareForRecognition(input)
    expect(out.length).toBe(input.length) // nothing is trimmed
    const mean = out.reduce((a, b) => a + b, 0) / out.length
    expect(Math.abs(mean)).toBeLessThan(1e-6)
    expect(Math.max(...out.map(Math.abs))).toBeCloseTo(0.2, 5) // gain capped at 10×
  })

  it('leaves a loud recording at its level and never clips past ±1', () => {
    const input = new Float32Array([0.95, -0.95, 0.5, -0.5])
    const out = prepareForRecognition(input)
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(1)
    expect(out[0]).toBeCloseTo(0.95, 5)
  })

  it('handles silence and empty input', () => {
    expect(prepareForRecognition(new Float32Array(0)).length).toBe(0)
    expect([...prepareForRecognition(new Float32Array(4))]).toEqual([0, 0, 0, 0])
  })
})
