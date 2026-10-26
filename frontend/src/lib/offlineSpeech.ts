// Client for the offline Whisper worker (see whisper.worker.ts and scripts/setup-offline-voice.mjs).
import type { WorkerRequest, WorkerResponse } from './whisper.worker'

export type VoiceLanguage = 'urdu' | 'english'
export type OfflineModels = Record<VoiceLanguage, string>

const MANIFEST = '/models/offline-voice.json'

let modelsPromise: Promise<OfflineModels | null> | null = null

const isWhisper = (m: unknown): m is string => typeof m === 'string' && m.includes('whisper')

/**
 * The installed offline model for each language, or null when `npm run setup:voice` hasn't been
 * run. A missing file may come back as the app's HTML page, so the body is checked, not the status.
 * Accepts the older single-model manifest (`{ model }`) too.
 */
export function offlineVoiceModels(): Promise<OfflineModels | null> {
  modelsPromise ??= fetch(MANIFEST, { cache: 'no-store' })
    .then(async (r) => {
      if (!r.ok) return null
      const data = (await r.json().catch(() => null)) as {
        model?: unknown
        models?: { urdu?: unknown; english?: unknown }
      } | null
      if (isWhisper(data?.models?.urdu) && isWhisper(data?.models?.english))
        return { urdu: data.models.urdu, english: data.models.english }
      if (isWhisper(data?.model)) return { urdu: data.model, english: data.model }
      return null
    })
    .catch(() => null)
  return modelsPromise
}

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>()
let onProgress: ((percent: number) => void) | null = null

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data
    if (msg.type === 'progress') onProgress?.(msg.percent)
    else if (msg.type === 'result') {
      waiting.get(msg.id)?.resolve(msg.text)
      waiting.delete(msg.id)
    } else if (msg.type === 'error') {
      const err = new Error(msg.message)
      if (msg.id !== undefined) {
        waiting.get(msg.id)?.reject(err)
        waiting.delete(msg.id)
      } else waiting.forEach((w) => w.reject(err))
    }
  }
  worker.onerror = (e) => {
    const err = new Error(e.message || 'The offline speech engine failed to start.')
    waiting.forEach((w) => w.reject(err))
    waiting.clear()
    worker = null
  }
  return worker
}

/** Starts loading a model in the background (first use takes a few seconds). */
export function preloadOfflineVoice(model: string) {
  getWorker().postMessage({ type: 'load', model } satisfies WorkerRequest)
}

/** Converts 16 kHz mono samples to text on this device. */
export function transcribeOffline(
  model: string,
  audio: Float32Array,
  language: VoiceLanguage,
  progress?: (percent: number) => void,
): Promise<string> {
  onProgress = progress ?? null
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    getWorker().postMessage(
      { type: 'transcribe', id, model, audio, language } satisfies WorkerRequest,
      [audio.buffer],
    )
  })
}
