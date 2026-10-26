/// <reference lib="webworker" />
// Offline speech-to-text: runs Whisper in this worker with ONNX Runtime (WebAssembly).
// The model comes from this app's own /models/ folder and the runtime from the app bundle,
// so recognition needs no internet and no audio leaves the device.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = '/models/'
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } }
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm }
  // Threads need cross-origin isolation, which the dev/preview servers don't set.
  onnx.wasm.numThreads = 1
}

export type WorkerRequest =
  | { type: 'load'; model: string }
  | {
      type: 'transcribe'
      id: number
      model: string
      audio: Float32Array
      language: 'urdu' | 'english'
    }

export type WorkerResponse =
  | { type: 'progress'; percent: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string }

// One pipeline per model (Urdu and English can use different models); each loads once.
const loaded = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>()

function load(model: string) {
  const existing = loaded.get(model)
  if (existing) return existing
  const files = new Map<string, number>()
  const loading = pipeline('automatic-speech-recognition', model, {
    device: 'wasm',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    progress_callback: (p: { status: string; file?: string; progress?: number }) => {
      if (p.status === 'progress' && p.file) {
        files.set(p.file, p.progress ?? 0)
        const avg = [...files.values()].reduce((a, b) => a + b, 0) / files.size
        post({ type: 'progress', percent: Math.round(avg) })
      }
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>
  loaded.set(model, loading)
  loading.catch(() => loaded.delete(model))
  return loading
}

const post = (msg: WorkerResponse) => (self as DedicatedWorkerGlobalScope).postMessage(msg)

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      await load(msg.model)
      post({ type: 'ready' })
      return
    }
    const asr = await load(msg.model)
    const out = await asr(msg.audio, {
      language: msg.language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    })
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim()
    post({ type: 'result', id: msg.id, text })
  } catch (err) {
    post({
      type: 'error',
      id: msg.type === 'transcribe' ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
