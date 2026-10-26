/**
 * Converts any audio the browser can decode (a microphone recording, MP3, M4A, OGG, WAV …)
 * into 16 kHz mono 16-bit PCM WAV — the format the backend stores and Gemma 4 transcribes.
 */
const TARGET_RATE = 16_000

export async function toWav16k(input: Blob): Promise<{ wav: Blob; seconds: number }> {
  const bytes = await input.arrayBuffer()
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(bytes)
  } finally {
    void ctx.close()
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE))
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination) // multi-channel input is mixed down to mono
  src.start()
  const rendered = await offline.startRendering()
  return { wav: encodeWav(rendered.getChannelData(0), TARGET_RATE), seconds: decoded.duration }
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true) // PCM chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}
