// Downloads the Whisper speech models used for OFFLINE voice typing into public/models/.
// Run once while online:
//   npm run setup:voice             both models (~315 MB): whisper-small for Urdu, whisper-base for English
//   npm run setup:voice -- base     only whisper-base (~77 MB, faster, weaker Urdu)
//   npm run setup:voice -- small    only whisper-small (~240 MB, used for both languages)
// After that, voice typing works with no internet: the app serves the models itself and the
// browser runs them locally (nothing is sent anywhere). The files are git-ignored.
//
// Measured on real Urdu speech (character error rate, lower is better): base 31.9%, small 26.5%;
// small is about 3× slower, so English — which base handles well — keeps the faster model.
import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const choice = (process.argv[2] ?? 'all').toLowerCase()
if (!['all', 'base', 'small'].includes(choice)) {
  console.error('Usage: npm run setup:voice -- [all|base|small]')
  process.exit(1)
}
const sizes = choice === 'all' ? ['small', 'base'] : [choice]
const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'added_tokens.json',
  'normalizer.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
]

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models')
const modelId = (size) => `onnx-community/whisper-${size}`
const installed = (size) => FILES.every((f) => existsSync(join(root, modelId(size), f)))

async function download(model, file) {
  const dest = join(root, model, file)
  mkdirSync(dirname(dest), { recursive: true })
  const res = await fetch(`https://huggingface.co/${model}/resolve/main/${file}`)
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  if (total && existsSync(dest) && statSync(dest).size === total) {
    console.log(`  ✓ ${file} (already downloaded)`)
    await res.body?.cancel()
    return
  }
  let done = 0
  let lastPct = -1
  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => {
    done += chunk.length
    const pct = total ? Math.floor((done / total) * 100) : 0
    if (total > 5e6 && pct % 10 === 0 && pct !== lastPct) {
      lastPct = pct
      process.stdout.write(`\r  … ${file} ${pct}%`)
    }
  })
  await pipeline(body, createWriteStream(dest))
  process.stdout.write(`\r  ✓ ${file} (${(done / 1e6).toFixed(1)} MB)          \n`)
}

try {
  for (const size of sizes) {
    console.log(`Downloading ${modelId(size)} into public/models/ …`)
    for (const f of FILES) await download(modelId(size), f)
  }
} catch (err) {
  console.error(
    `\nDownload failed: ${err.message}. Check the internet connection and run it again.`,
  )
  process.exit(1)
}

// The app reads this manifest to know which offline model each language uses.
const small = installed('small')
const base = installed('base')
const models = {
  urdu: modelId(small ? 'small' : 'base'),
  english: modelId(base ? 'base' : 'small'),
}
writeFileSync(join(root, 'offline-voice.json'), JSON.stringify({ models }, null, 2) + '\n')
console.log(`Done. Offline voice typing: Urdu → ${models.urdu}, English → ${models.english}.`)
console.log('Reload the page to use it.')
