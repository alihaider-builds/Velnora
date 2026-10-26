// Light clean-up of a microphone recording before speech recognition (16 kHz mono samples):
// remove any DC offset and bring quiet recordings up to a normal level (gain capped at 10×).
// Measured on real Urdu speech this lowered Whisper's character error rate (base 33.3% → 31.9%,
// small 27.6% → 26.5%); trimming silence was also tried and made results worse, so it isn't done.
// The stored voice note is NOT changed — this copy is only what the recogniser hears.

const TARGET_PEAK = 0.9
const MAX_GAIN = 10

export function prepareForRecognition(input: Float32Array): Float32Array {
  if (input.length === 0) return input
  let mean = 0
  for (let i = 0; i < input.length; i++) mean += input[i]
  mean /= input.length

  let peak = 0
  for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i] - mean))
  const gain = peak > 0 ? Math.max(1, Math.min(MAX_GAIN, TARGET_PEAK / peak)) : 1

  const out = new Float32Array(input.length)
  for (let i = 0; i < input.length; i++) {
    out[i] = Math.max(-1, Math.min(1, (input[i] - mean) * gain))
  }
  return out
}
