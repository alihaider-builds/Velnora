// In-memory stand-in for the backend, used only when VITE_USE_MOCKS=true.
// Rules mirror BACKEND_TECH_SPEC.md: §4.5 status rules, §6 duplicates, §8 masking.
import type {
  Channel,
  DuplicateCandidate,
  Evidence,
  Extraction,
  Language,
  NeedCategory,
  PublicReport,
  Report,
  ReportListItem,
} from '../api/types'

export const MOCK_MODEL = 'gemma4:e4b'

// ---- Text helpers -------------------------------------------------------------------------

/** Code-point offsets of `phrase` in `text`, computed — never typed by hand (UI_UX_SPEC §9). */
export function evidence(text: string, phrase: string, after = 0): Evidence {
  const cps = Array.from(text)
  const prefix = cps.slice(0, after).join('')
  const idx = text.indexOf(phrase, prefix.length)
  if (idx < 0) return { phrase, start: null, end: null, matched: false }
  const start = Array.from(text.slice(0, idx)).length
  return { phrase, start, end: start + Array.from(phrase).length, matched: true }
}

const PHONE =
  /(\+92[-\s]?3\d{2}[-\s]?\d{7}|0092[-\s]?3\d{2}[-\s]?\d{7}|03\d{2}[-\s]?\d{7}|\d{10,})/g

/** §8: same-length masking so evidence offsets still line up with masked_text. */
export function maskText(text: string): string {
  return text.replace(PHONE, (m) => m.slice(0, 2) + m.slice(2).replace(/\d/g, '•'))
}

/** "+923001234541" → "+92 3•• ••• ••41" (format from §4.3). */
export function maskSender(from: string): string {
  const digits = from.replace(/\D/g, '')
  return `+92 3•• ••• ••${digits.slice(-2)}`
}

const URDU = /[؀-ۿݐ-ݿ]/
const ENGLISH_WORDS = /\b(the|and|need|needs|water|food|near|please|family|people|stranded)\b/i

export function detectLanguage(text: string): Language {
  if (URDU.test(text)) return /[a-z]{3,}/i.test(text) ? 'mixed' : 'urdu'
  return ENGLISH_WORDS.test(text) ? 'english' : 'roman_urdu'
}

const VARIANTS: Record<string, string> = {
  main: 'mein',
  me: 'mein',
  chahye: 'chahiye',
  chahie: 'chahiye',
  chaheye: 'chahiye',
  dawa: 'dawai',
  dawaee: 'dawai',
  gher: 'ghar',
  gya: 'gaya',
}

/** §6.1-style normalisation (lowercase, strip punctuation, collapse repeats, variant map). */
export function normalizeWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/(\p{L})\1+/gu, '$1').replace(/hh/g, 'h'))
    .map((w) => VARIANTS[w] ?? w)
}

// ---- Fake extraction (mock only) ----------------------------------------------------------

const NEED_WORDS: [NeedCategory, string[]][] = [
  ['medicine', ['dawai', 'dawa', 'medicine', 'doctor', 'دوائی', 'دوا']],
  ['clean_water', ['saaf pani', 'saaf paani', 'clean water', 'drinking water', 'صاف پانی']],
  ['food', ['khana', 'ration', 'food', 'کھانا', 'خوراک']],
  ['shelter', ['tent', 'shelter', 'chhat', 'خیمہ', 'چھت']],
  ['evacuation', ['nikalna', 'nikalo', 'evacuat', 'rescue', 'boat', 'stranded']],
]

export const GAZETTEER = [
  {
    name: 'Pir Baba',
    label: 'Pir Baba, Buner, Khyber Pakhtunkhwa',
    lat: 34.493,
    lng: 72.307,
    type: 'village',
    importance: 0.41,
  },
  {
    name: 'Buner',
    label: 'Buner District, Khyber Pakhtunkhwa',
    lat: 34.443,
    lng: 72.499,
    type: 'district',
    importance: 0.55,
  },
  {
    name: 'Daggar',
    label: 'Daggar, Buner, Khyber Pakhtunkhwa',
    lat: 34.501,
    lng: 72.473,
    type: 'town',
    importance: 0.38,
  },
  {
    name: 'Swat',
    label: 'Swat District, Khyber Pakhtunkhwa',
    lat: 35.222,
    lng: 72.425,
    type: 'district',
    importance: 0.58,
  },
  {
    name: 'Mingora',
    label: 'Mingora, Swat, Khyber Pakhtunkhwa',
    lat: 34.776,
    lng: 72.361,
    type: 'city',
    importance: 0.5,
  },
  {
    name: 'Kalam',
    label: 'Kalam, Swat, Khyber Pakhtunkhwa',
    lat: 35.489,
    lng: 72.584,
    type: 'town',
    importance: 0.44,
  },
  {
    name: 'Shangla',
    label: 'Shangla District, Khyber Pakhtunkhwa',
    lat: 34.885,
    lng: 72.619,
    type: 'district',
    importance: 0.47,
  },
  {
    name: 'Charsadda',
    label: 'Charsadda, Khyber Pakhtunkhwa',
    lat: 34.148,
    lng: 71.731,
    type: 'city',
    importance: 0.49,
  },
  {
    name: 'Nowshera',
    label: 'Nowshera, Khyber Pakhtunkhwa',
    lat: 34.015,
    lng: 71.975,
    type: 'city',
    importance: 0.49,
  },
  {
    name: 'Mardan',
    label: 'Mardan, Khyber Pakhtunkhwa',
    lat: 34.198,
    lng: 72.045,
    type: 'city',
    importance: 0.52,
  },
  {
    name: 'سوات',
    label: 'Swat District, Khyber Pakhtunkhwa',
    lat: 35.222,
    lng: 72.425,
    type: 'district',
    importance: 0.58,
  },
  {
    name: 'بونیر',
    label: 'Buner District, Khyber Pakhtunkhwa',
    lat: 34.443,
    lng: 72.499,
    type: 'district',
    importance: 0.55,
  },
]

export function fakeExtract(text: string, attempts = 1): Extraction {
  const lower = text.toLowerCase()
  const needs: Extraction['needs'] = []
  for (const [category, words] of NEED_WORDS) {
    const word = words.find((w) => lower.includes(w.toLowerCase()))
    if (!word) continue
    const idx = lower.indexOf(word.toLowerCase())
    needs.push({ category, evidence: evidence(text, text.slice(idx, idx + word.length)) })
  }
  if (needs.length === 0)
    needs.push({ category: 'other', evidence: evidence(text, text.split(/[,.]/)[0]) })

  const quantities: Extraction['quantities'] = []
  const q =
    /(\d+)\s+(bachay|bachhay|bachy|children|log|people|families|family members|khandan)/i.exec(text)
  if (q) {
    const label = /bach|child/i.test(q[2])
      ? 'children'
      : /famil|khandan/i.test(q[2])
        ? 'families'
        : 'people'
    quantities.push({ value: Number(q[1]), label, evidence: evidence(text, q[0]) })
  }

  const place = GAZETTEER.find((p) => text.includes(p.name))

  return {
    status: 'succeeded',
    model: MOCK_MODEL,
    attempts,
    completed_at: new Date().toISOString(),
    error: null,
    language: detectLanguage(text),
    needs,
    quantities,
    place_name: place ? { text: place.name, evidence: evidence(text, place.name) } : null,
    time_reference: null,
    uncertainties: place ? [] : ['No place name found in the message.'],
  }
}

export function emptyExtraction(
  status: 'pending' | 'failed',
  attempts = 0,
  error: string | null = null,
): Extraction {
  return {
    status,
    model: MOCK_MODEL,
    attempts,
    completed_at: null,
    error,
    language: null,
    needs: [],
    quantities: [],
    place_name: null,
    time_reference: null,
    uncertainties: [],
  }
}

// ---- Effective values ---------------------------------------------------------------------

export function effectiveNeeds(r: Report): NeedCategory[] {
  return r.reviewer_fields.needs ?? r.extraction.needs.map((n) => n.category)
}

export function effectivePlace(r: Report): string | null {
  return r.reviewer_fields.place_name ?? r.extraction.place_name?.text ?? null
}

// ---- §6.2 Duplicates ----------------------------------------------------------------------

function pointOf(r: Report) {
  return r.location.confirmed ?? r.location.suggested ?? r.location.submitted_point ?? null
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

function jaccard<T>(a: T[], b: T[]): number {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size === 0 && B.size === 0) return 0
  let inter = 0
  A.forEach((x) => B.has(x) && inter++)
  return inter / (A.size + B.size - inter)
}

export function findDuplicates(
  target: Report,
  all: Report[],
  senderOf: (id: string) => string | null,
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = []
  const tNeeds = effectiveNeeds(target)
  const tWords = normalizeWords(target.source_text)
  const tPoint = pointOf(target)
  const tPlace = effectivePlace(target)?.toLowerCase() ?? null

  for (const r of all) {
    if (r.id === target.id || r.status === 'rejected' || r.status === 'merged') continue
    const hours =
      Math.abs(new Date(r.created_at).getTime() - new Date(target.created_at).getTime()) / 3.6e6
    if (hours > 24) continue

    const reasons: string[] = []
    const needs = effectiveNeeds(r)
    const needSim = jaccard(tNeeds, needs)
    const textSim = jaccard(tWords, normalizeWords(r.source_text))
    const point = pointOf(r)
    let distSim = 0
    if (tPoint && point) {
      const d = km(tPoint, point)
      distSim = Math.max(0, 1 - d / 2)
      if (distSim > 0) reasons.push(d < 0.1 ? 'Same location' : `${d.toFixed(1)} km apart`)
    } else if (tPlace && tPlace === effectivePlace(r)?.toLowerCase()) {
      distSim = 0.5
      reasons.push(`Same place: ${effectivePlace(r)}`)
    }
    const timeSim = 1 - hours / 24

    let score = 0.4 * textSim + 0.3 * needSim + 0.2 * distSim + 0.1 * timeSim
    const shared = tNeeds.filter((n) => needs.includes(n))
    if (shared.length)
      reasons.unshift(`Same needs: ${shared.map((n) => n.replace('_', ' ')).join(', ')}`)
    reasons.push(`${Math.max(1, Math.round(hours))} h apart`)
    if (textSim >= 0.3) reasons.push(`Similar wording (text similarity ${textSim.toFixed(2)})`)
    const s1 = senderOf(target.id)
    if (s1 && s1 === senderOf(r.id)) {
      score += 0.15
      reasons.push('Same sender')
    }
    score = Math.min(1, score)
    if (score < 0.55) continue

    out.push({
      report_id: r.id,
      score: Math.round(score * 100) / 100,
      reasons,
      summary: { created_at: r.created_at, needs, place: effectivePlace(r), status: r.status },
    })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5)
}

// ---- Projections --------------------------------------------------------------------------

export function toListItem(r: Report): ReportListItem {
  return {
    id: r.id,
    reference: r.reference,
    created_at: r.created_at,
    is_synthetic: r.is_synthetic,
    channel: r.channel,
    preview: Array.from(r.masked_text).slice(0, 80).join(''),
    language: r.extraction.language,
    needs: effectiveNeeds(r),
    place: effectivePlace(r),
    extraction_status: r.extraction.status,
    transcript_status: r.call?.transcript_status ?? null,
    has_voice_note: !!r.voice_note,
    status: r.status,
    urgency: r.urgency,
    duplicate_count: r.duplicate_count,
    has_confirmed_location: r.location.confirmed !== null,
  }
}

export function toPublic(r: Report): PublicReport | null {
  if (r.status !== 'approved' || !r.location.confirmed) return null
  const approved = [...r.audit].reverse().find((a) => a.action === 'approve')
  return {
    id: r.id,
    needs: effectiveNeeds(r),
    area_label: r.location.confirmed.label,
    lat: Math.round(r.location.confirmed.lat * 100) / 100,
    lng: Math.round(r.location.confirmed.lng * 100) / 100,
    approved_at: approved?.at ?? r.updated_at,
    is_synthetic: r.is_synthetic,
  }
}

export function newId(): string {
  return crypto.randomUUID()
}

export function referenceFor(id: string): string {
  return `RL-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`
}

export type { Channel }
