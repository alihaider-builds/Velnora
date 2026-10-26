// MSW handlers implementing every endpoint in BACKEND_TECH_SPEC.md §4.4 against in-memory state.
// Mock-only switches (never real credentials):
//   VITE_MOCK_REVIEWER_PASSWORD  — password the mock accepts (default "demo")
//   VITE_MOCK_DEMO_MODE=false    — simulate a backend with demo mode off
// A geocode query containing "unavailable" returns 502 so the fallback UI can be exercised.
import {
  delay,
  http,
  HttpResponse,
  type DefaultBodyType,
  type HttpResponseResolver,
  type PathParams,
} from 'msw'
import type {
  Category,
  CategoryCreateRequest,
  CategoryPatchRequest,
  Helpline,
  HelplineCreateRequest,
  HelplinePatchRequest,
  PlaceSuggestion,
  ConfirmLocationRequest,
  MergeRequest,
  NeedCategory,
  Report,
  ReportStatus,
  ReviewerFields,
  ReviewRequest,
  SimulatorSendRequest,
  TranscriptRequest,
} from '../api/types'
import {
  effectiveNeeds,
  emptyExtraction,
  fakeExtract,
  findDuplicates,
  GAZETTEER,
  maskSender,
  maskText,
  MOCK_MODEL,
  newId,
  referenceFor,
  toListItem,
  toPublic,
} from './engine'
import { MOCK_IMAGE_SVG, seedRecords, type MockRecord } from './fixtures'

const PASSWORD = import.meta.env.VITE_MOCK_REVIEWER_PASSWORD || 'demo'
const DEMO_MODE = import.meta.env.VITE_MOCK_DEMO_MODE !== 'false'
const SESSION_KEY = 'relieflens-mock-session'

// State survives page reloads within the tab (sessionStorage), so a demo isn't lost on refresh.
const DB_KEY = 'relieflens-mock-db'

function loadDb(): MockRecord[] {
  try {
    const saved = sessionStorage.getItem(DB_KEY)
    if (saved) return JSON.parse(saved) as MockRecord[]
  } catch {
    // Fall through to fresh seed data.
  }
  return seedRecords()
}

const db: MockRecord[] = loadDb()

/** Called after every mocked response (see browser.ts). */
export function persistDb() {
  try {
    sessionStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    // Storage full or blocked — state simply won't survive a reload.
  }
}

// ---- Helpers ------------------------------------------------------------------------------

function error(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message, details: {} } }, { status })
}

function signedIn(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

const unauthorized = () => error(401, 'UNAUTHORIZED', 'Sign in to continue.')

function rateLimiter(limit: number) {
  const hits: number[] = []
  return () => {
    const now = Date.now()
    while (hits.length && now - hits[0] > 60_000) hits.shift()
    hits.push(now)
    return hits.length > limit
  }
}
const submitLimited = rateLimiter(10)
const simulatorLimited = rateLimiter(20)
const loginFailures: number[] = []

function record(id: string) {
  return db.find((r) => r.report.id === id)
}

function senderOf(id: string) {
  return record(id)?.from ?? null
}

/** Recomputes derived fields the backend computes on read (duplicates, sender). */
function refresh(rec: MockRecord): Report {
  const r = rec.report
  r.duplicate_count = findDuplicates(
    r,
    db.map((x) => x.report),
    senderOf,
  ).length
  if (r.sender && rec.from) {
    const since = Date.now() - 24 * 3.6e6
    r.sender.same_sender_count = db.filter(
      (x) => x !== rec && x.from === rec.from && new Date(x.report.created_at).getTime() > since,
    ).length
  }
  return r
}

/** Pending extractions flip to succeeded after a few polls (UI_UX_SPEC §9). */
function tick(rec: MockRecord) {
  const ex = rec.report.extraction
  if (ex.status !== 'pending' && ex.status !== 'running') return
  rec.pendingPolls -= 1
  if (rec.pendingPolls <= 1) ex.status = 'running'
  if (rec.pendingPolls <= 0) {
    rec.report.extraction = fakeExtract(rec.report.source_text, ex.attempts + 1)
    autoGeocode(rec.report)
  }
}

function autoGeocode(r: Report) {
  const place = r.extraction.place_name?.text
  const hit = place ? GAZETTEER.find((g) => g.name === place) : undefined
  if (hit && !r.location.suggested) {
    r.location.suggested = {
      lat: hit.lat,
      lng: hit.lng,
      label: hit.label,
      source: 'geocoder_candidate',
    }
  }
}

function audit(r: Report, action: string, note: string | null, to?: ReportStatus) {
  const at = new Date().toISOString()
  r.audit.push({
    at,
    actor: 'reviewer',
    action,
    from_status: to ? r.status : null,
    to_status: to ?? null,
    note,
  })
  if (to) r.status = to
  r.updated_at = at
}

function createReport(input: {
  text: string
  channel: Report['channel']
  from: string | null
  placeText: string | null
  point: { lat: number; lng: number } | null
  hasImage: boolean
}): MockRecord {
  const id = newId()
  const now = new Date().toISOString()
  const report: Report = {
    id,
    reference: referenceFor(id),
    created_at: now,
    updated_at: now,
    is_synthetic: DEMO_MODE,
    channel: input.channel,
    sender: input.from ? { masked: maskSender(input.from), same_sender_count: 0 } : null,
    call: null,
    source_text: input.text,
    masked_text: maskText(input.text),
    has_image: input.hasImage,
    image_url: input.hasImage ? `/api/reports/${id}/image` : null,
    extraction: { ...emptyExtraction('pending'), model: MOCK_MODEL },
    reviewer_fields: { needs: null, quantities: null, place_name: null, time_reference: null },
    location: {
      submitted_text: input.placeText,
      submitted_point: input.point,
      suggested: null,
      confirmed: null,
    },
    status: 'pending_review',
    urgency: 'unknown',
    merged_into: null,
    duplicate_count: 0,
    audit: [],
  }
  const rec: MockRecord = { report, from: input.from, pendingPolls: 3 }
  db.push(rec)
  return rec
}

/** Wraps a resolver so it answers 401 without the (mock) session, like reviewer endpoints. */
function reviewerOnly<P extends PathParams>(
  fn: HttpResponseResolver<P, DefaultBodyType>,
): HttpResponseResolver<P, DefaultBodyType> {
  return async (info) => {
    await delay(150)
    return signedIn() ? fn(info) : unauthorized()
  }
}

// ---- Handlers -----------------------------------------------------------------------------

export const handlers = [
  http.get('/api/health', async () => {
    await delay(100)
    return HttpResponse.json({
      status: 'ok',
      model: MOCK_MODEL,
      model_available: true,
      transcriber: 'none',
      transcriber_available: false,
      map_provider: 'osm',
      demo_mode: DEMO_MODE,
    })
  }),

  // Auth
  http.post('/api/auth/login', async ({ request }) => {
    await delay(250)
    const now = Date.now()
    while (loginFailures.length && now - loginFailures[0] > 60_000) loginFailures.shift()
    if (loginFailures.length >= 5)
      return error(429, 'RATE_LIMITED', 'Too many attempts, wait a minute.')
    const { password } = (await request.json()) as { password?: string }
    if (password !== PASSWORD) {
      loginFailures.push(now)
      return error(401, 'INVALID_CREDENTIALS', 'Incorrect password.')
    }
    sessionStorage.setItem(SESSION_KEY, '1')
    return HttpResponse.json({ reviewer: 'reviewer' })
  }),
  http.post(
    '/api/auth/logout',
    reviewerOnly(() => {
      sessionStorage.removeItem(SESSION_KEY)
      return new HttpResponse(null, { status: 204 })
    }),
  ),
  http.get('/api/auth/me', async () => {
    await delay(80)
    return signedIn() ? HttpResponse.json({ reviewer: 'reviewer' }) : unauthorized()
  }),

  // Submission
  http.post('/api/reports', async ({ request }) => {
    await delay(500)
    if (submitLimited()) return error(429, 'RATE_LIMITED', 'Too many reports from this connection.')
    const form = await request.formData()
    const text = String(form.get('text') ?? '').trim()
    if (text.length < 10 || text.length > 2000) {
      return HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Text must be 10–2,000 characters.',
            details: { field: 'text' },
          },
        },
        { status: 400 },
      )
    }
    const image = form.get('image')
    if (image instanceof File && image.size > 0) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) {
        return error(415, 'UNSUPPORTED_IMAGE', 'Use a JPG, PNG or WebP photo.')
      }
      if (image.size > 5 * 1024 * 1024)
        return error(413, 'IMAGE_TOO_LARGE', 'Photo must be 5 MB or smaller.')
    }
    const lat = form.get('lat')
    const lng = form.get('lng')
    const rec = createReport({
      text,
      channel: 'web',
      from: null,
      placeText: (form.get('place_text') as string) || null,
      point: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
      hasImage: image instanceof File && image.size > 0,
    })
    return HttpResponse.json(
      { id: rec.report.id, reference: rec.report.reference, status: 'pending_review' },
      { status: 201 },
    )
  }),

  // Simulator (§16)
  http.post('/api/simulator/send', async ({ request }) => {
    await delay(700)
    if (!DEMO_MODE) return error(404, 'NOT_FOUND', 'Simulator is only available in demo mode.')
    if (simulatorLimited())
      return error(429, 'RATE_LIMITED', 'Too many messages. Try again in a minute.')
    const body = (await request.json()) as SimulatorSendRequest
    if (!body.body?.trim()) return error(400, 'VALIDATION_ERROR', 'Message is empty.')
    const rec = createReport({
      text: body.body.trim(),
      channel: body.channel,
      from: body.from,
      placeText: null,
      point: null,
      hasImage: false,
    })
    const ref = rec.report.reference
    const reply =
      `Shukriya! Aap ki report mil gayi hai (${ref}). Ek volunteer isay review karega.\n` +
      `Fori khatray ki soorat mein 1122 par call karein.\n` +
      `Thank you, report ${ref} received. In a life-threatening emergency, call 1122.`
    return HttpResponse.json({ report_id: rec.report.id, reference: ref, reply })
  }),

  // Reviewer: reports
  http.get(
    '/api/reports',
    reviewerOnly(({ request }) => {
      const url = new URL(request.url)
      const statuses = url.searchParams.getAll('status')
      const channels = url.searchParams.getAll('channel')
      const urgencies = url.searchParams.getAll('urgency')
      const need = url.searchParams.get('need') as NeedCategory | null
      const extraction = url.searchParams.get('extraction_status')
      const q = url.searchParams.get('q')?.toLowerCase().trim()
      const sort = url.searchParams.get('sort') ?? 'newest'
      const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
      const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size') ?? 25)))

      db.forEach(tick)
      let rows = db
        .map(refresh)
        .filter(
          (r) =>
            (statuses.length === 0 || statuses.includes(r.status)) &&
            (channels.length === 0 || channels.includes(r.channel)) &&
            (urgencies.length === 0 || urgencies.includes(r.urgency)) &&
            (!need || effectiveNeeds(r).includes(need)) &&
            (!extraction || r.extraction.status === extraction) &&
            (!q || r.masked_text.toLowerCase().includes(q)),
        )

      const age = (r: Report) => new Date(r.created_at).getTime()
      // Time order only — the reviewer decides what matters most.
      rows = rows.sort((a, b) => (sort === 'oldest' ? age(a) - age(b) : age(b) - age(a)))

      const items = rows.slice((page - 1) * pageSize, page * pageSize).map(toListItem)
      return HttpResponse.json({ items, total: rows.length, page, page_size: pageSize })
    }),
  ),

  http.get(
    '/api/reports/:id',
    reviewerOnly(({ params }) => {
      const rec = record(String(params.id))
      if (!rec) return error(404, 'NOT_FOUND', 'Report not found.')
      tick(rec)
      return HttpResponse.json(refresh(rec))
    }),
  ),

  http.get(
    '/api/reports/:id/original',
    reviewerOnly(({ params }) => {
      const rec = record(String(params.id))
      if (!rec) return error(404, 'NOT_FOUND', 'Report not found.')
      audit(rec.report, 'reveal_original', null)
      return HttpResponse.json({ source_text: rec.report.source_text, sender: rec.from })
    }),
  ),

  http.get(
    '/api/reports/:id/image',
    reviewerOnly(({ params }) => {
      const rec = record(String(params.id))
      if (!rec?.report.has_image) return error(404, 'NOT_FOUND', 'No image.')
      return new HttpResponse(MOCK_IMAGE_SVG, { headers: { 'Content-Type': 'image/svg+xml' } })
    }),
  ),

  http.post(
    '/api/reports/:id/retry-extraction',
    reviewerOnly(({ params }) => {
      const rec = record(String(params.id))
      if (!rec) return error(404, 'NOT_FOUND', 'Report not found.')
      const ex = rec.report.extraction
      if (ex.status === 'pending' || ex.status === 'running') {
        return error(409, 'EXTRACTION_IN_PROGRESS', 'Extraction is already running.')
      }
      rec.report.extraction = emptyExtraction('pending', ex.attempts)
      rec.pendingPolls = 3
      return HttpResponse.json(refresh(rec), { status: 202 })
    }),
  ),

  http.patch(
    '/api/reports/:id/fields',
    reviewerOnly(async ({ params, request }) => {
      const rec = record(String(params.id))
      if (!rec) return error(404, 'NOT_FOUND', 'Report not found.')
      const patch = (await request.json()) as Partial<ReviewerFields>
      rec.report.reviewer_fields = { ...rec.report.reviewer_fields, ...patch }
      audit(rec.report, 'edit_fields', null)
      return HttpResponse.json(refresh(rec))
    }),
  ),

  http.delete(
    '/api/reports/:id',
    reviewerOnly(({ params }) => {
      const idx = db.findIndex((r) => r.report.id === params.id)
      if (idx < 0) return error(404, 'NOT_FOUND', 'Report not found.')
      db.splice(idx, 1)
      return new HttpResponse(null, { status: 204 })
    }),
  ),

  // Reviewer: location
  http.get(
    '/api/geocode',
    reviewerOnly(async ({ request }) => {
      await delay(300)
      const q = (new URL(request.url).searchParams.get('q') ?? '').trim()
      if (q.length < 2 || q.length > 200)
        return error(400, 'VALIDATION_ERROR', 'Query must be 2–200 characters.')
      if (q.toLowerCase().includes('unavailable'))
        return error(502, 'GEOCODER_UNAVAILABLE', 'Map search is unavailable.')
      const words = q
        .toLowerCase()
        .split(/[\s,]+/)
        .filter((w) => w.length > 1)
      const seen = new Set<string>()
      const candidates = GAZETTEER.filter((g) =>
        words.some((w) => g.label.toLowerCase().includes(w) || g.name.includes(w)),
      )
        .filter((g) => !seen.has(g.label) && seen.add(g.label))
        .sort(
          (a, b) =>
            Number(b.label.toLowerCase().startsWith(words[0])) -
              Number(a.label.toLowerCase().startsWith(words[0])) || b.importance - a.importance,
        )
        .slice(0, 5)
        .map(({ lat, lng, label, type, importance }) => ({ lat, lng, label, type, importance }))
      return HttpResponse.json({ candidates })
    }),
  ),

  http.post(
    '/api/reports/:id/location',
    reviewerOnly(async ({ params, request }) => {
      const rec = record(String(params.id))
      if (!rec) return error(404, 'NOT_FOUND', 'Report not found.')
      const body = (await request.json()) as ConfirmLocationRequest
      rec.report.location.confirmed = { ...body, confirmed_at: new Date().toISOString() }
      audit(rec.report, 'confirm_location', body.label)
      return HttpResponse.json(refresh(rec))
    }),
  ),

  // Reviewer: duplicates and review
  http.get(
    '/api/reports/:id/duplicates',
    reviewerOnly(({ params }) => {
      const rec = record(String(params.id))
      if (!rec) return error(404, 'NOT_FOUND', 'Report not found.')
      return HttpResponse.json({
        candidates: findDuplicates(
          rec.report,
          db.map((r) => r.report),
          senderOf,
        ),
      })
    }),
  ),

  http.post(
    '/api/reports/:id/merge',
    reviewerOnly(async ({ params, request }) => {
      const rec = record(String(params.id))
      if (!rec) return error(404, 'NOT_FOUND', 'Report not found.')
      const body = (await request.json()) as MergeRequest
      const target = record(body.target_id)
      const from = rec.report.status
      if (
        !target ||
        target === rec ||
        target.report.status === 'merged' ||
        target.report.status === 'rejected' ||
        (from !== 'pending_review' && from !== 'flagged')
      ) {
        return error(409, 'INVALID_MERGE_TARGET', 'This report cannot be merged into that one.')
      }
      rec.report.merged_into = target.report.id
      audit(rec.report, 'merge', body.note || `Merged into ${target.report.reference}`, 'merged')
      return HttpResponse.json(refresh(rec))
    }),
  ),

  http.post(
    '/api/reports/:id/review',
    reviewerOnly(async ({ params, request }) => {
      const rec = record(String(params.id))
      if (!rec) return error(404, 'NOT_FOUND', 'Report not found.')
      const body = (await request.json()) as ReviewRequest
      const r = rec.report
      const allowed: Record<
        ReportStatus,
        Partial<Record<NonNullable<ReviewRequest['action']>, ReportStatus>>
      > = {
        pending_review: { approve: 'approved', reject: 'rejected', flag: 'flagged' },
        flagged: { approve: 'approved', reject: 'rejected' },
        approved: { reopen: 'pending_review' },
        rejected: { reopen: 'pending_review' },
        merged: {},
      }
      if (!body.action && !body.urgency)
        return error(400, 'VALIDATION_ERROR', 'Give an action, an urgency, or both.')
      if (r.status === 'merged')
        return error(409, 'INVALID_TRANSITION', "Merged reports can't be reviewed.")
      const to = body.action ? allowed[r.status][body.action] : undefined
      if (body.action && !to)
        return error(
          409,
          'INVALID_TRANSITION',
          `Can't ${body.action} a report that is ${r.status.replace('_', ' ')}.`,
        )
      if (body.action === 'approve' && !r.location.confirmed) {
        return error(409, 'LOCATION_REQUIRED', 'Confirm a location before approving.')
      }
      if (body.urgency && body.urgency !== r.urgency) {
        audit(r, 'set_urgency', `Urgency: ${body.urgency}`)
        r.urgency = body.urgency
      }
      if (body.action && to) audit(r, body.action, body.note?.trim() || null, to)
      return HttpResponse.json(refresh(rec))
    }),
  ),

  // Public and dashboard
  http.get('/api/public/reports', async ({ request }) => {
    await delay(200)
    const needs = new URL(request.url).searchParams.getAll('need')
    const items = db
      .map((r) => toPublic(r.report))
      .filter((p) => p !== null)
      .filter((p) => needs.length === 0 || p.needs.some((n) => needs.includes(n)))
    return HttpResponse.json({ items, total: items.length })
  }),

  http.get('/api/public/stats', async () => {
    await delay(200)
    const pub = db.map((r) => toPublic(r.report)).filter((p) => p !== null)
    const by_need: Partial<Record<NeedCategory, number>> = {}
    const areas = new Map<string, number>()
    for (const p of pub) {
      p.needs.forEach((n) => (by_need[n] = (by_need[n] ?? 0) + 1))
      areas.set(p.area_label, (areas.get(p.area_label) ?? 0) + 1)
    }
    const by_area = [...areas]
      .map(([area_label, count]) => ({ area_label, count }))
      .sort((a, b) => b.count - a.count)
    return HttpResponse.json({ total_approved: pub.length, by_need, by_area })
  }),

  http.get(
    '/api/stats',
    reviewerOnly(() => {
      const count = <K extends string>(keys: K[]) => {
        const out: Partial<Record<K, number>> = {}
        keys.forEach((k) => (out[k] = (out[k] ?? 0) + 1))
        return out
      }
      const reports = db.map(refresh)
      return HttpResponse.json({
        by_status: count(reports.map((r) => r.status)),
        by_need: count(reports.filter((r) => r.status === 'approved').flatMap(effectiveNeeds)),
        by_extraction_status: count(reports.map((r) => r.extraction.status)),
        by_channel: count(reports.map((r) => r.channel)),
        by_urgency: count(reports.map((r) => r.urgency)),
      })
    }),
  ),
]

// ---- Help categories (in memory) ----------------------------------------------------------

const categories: Category[] = [
  ['food', 'Food', 'خوراک'],
  ['clean_water', 'Clean water', 'صاف پانی'],
  ['shelter', 'Shelter', 'پناہ'],
  ['medicine', 'Medicine', 'دوا'],
  ['evacuation', 'Evacuation', 'انخلا'],
  ['other', 'Other', 'دیگر'],
].map(([key, label, label_ur]) => ({
  key,
  label,
  label_ur,
  keywords: [],
  builtin: true,
  active: true,
  created_at: new Date().toISOString(),
}))

function categoryKey(label: string): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 28) || 'cat'
  let key = base
  for (let n = 2; categories.some((c) => c.key === key); n++) key = `${base}_${n}`
  return key
}

// Helplines (organizer-managed) and place suggestions.
const helplines: Helpline[] = []

function normPhone(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('0092')) d = d.slice(2)
  else if (d.startsWith('0') && d.length === 11) d = `92${d.slice(1)}`
  return d ? `+${d}` : ''
}

const MOCK_PLACES: PlaceSuggestion[] = [
  { name: 'Lalkurti', label: 'Lalkurti, Rawalpindi, Punjab', lat: 33.581, lng: 73.056 },
  { name: 'Saddar', label: 'Saddar, Rawalpindi, Punjab', lat: 33.596, lng: 73.051 },
  { name: 'Rawalpindi', label: 'Rawalpindi, Punjab', lat: 33.6, lng: 73.05 },
  { name: 'Rajanpur', label: 'Rajanpur, Punjab', lat: 29.104, lng: 70.33 },
  { name: 'Buner', label: 'Buner, Khyber Pakhtunkhwa', lat: 34.5, lng: 72.48 },
  { name: 'Charsadda', label: 'Charsadda, Khyber Pakhtunkhwa', lat: 34.15, lng: 71.74 },
  { name: 'Jacobabad', label: 'Jacobabad, Sindh', lat: 28.28, lng: 68.44 },
]

export const categoryHandlers = [
  http.get('/api/places/suggest', async ({ request }) => {
    await delay(150)
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase()
    if (q.length < 3) return error(400, 'VALIDATION_ERROR', 'Type at least 3 characters.')
    const items = MOCK_PLACES.filter((p) =>
      q.split(/\s+/).every((w) => p.label.toLowerCase().includes(w)),
    )
    return HttpResponse.json({ provider: 'osm', items })
  }),
  http.get('/api/helplines', () =>
    HttpResponse.json({
      items: helplines.filter((h) => h.active).map((h) => ({ number: h.number, label: h.label })),
    }),
  ),
  http.get(
    '/api/helplines/all',
    reviewerOnly(() => HttpResponse.json({ items: helplines })),
  ),
  http.post(
    '/api/helplines',
    reviewerOnly(async ({ request }) => {
      const body = (await request.json()) as HelplineCreateRequest
      const number = normPhone(body.number)
      if (number.length < 8) return error(400, 'VALIDATION_ERROR', 'Enter a phone number.')
      if (helplines.some((h) => h.number === number))
        return error(409, 'HELPLINE_EXISTS', 'This helpline number is already added.')
      const h: Helpline = {
        id: crypto.randomUUID(),
        number,
        label: body.label.trim(),
        provider_number: body.provider_number ? normPhone(body.provider_number) : null,
        active: true,
        created_at: new Date().toISOString(),
      }
      helplines.push(h)
      return HttpResponse.json(h, { status: 201 })
    }),
  ),
  http.patch(
    '/api/helplines/:id',
    reviewerOnly(async ({ params, request }) => {
      const h = helplines.find((x) => x.id === params.id)
      if (!h) return error(404, 'NOT_FOUND', 'Helpline not found.')
      const body = (await request.json()) as HelplinePatchRequest
      if (body.label) h.label = body.label.trim()
      if (body.provider_number !== undefined)
        h.provider_number = body.provider_number ? normPhone(body.provider_number) : null
      if (body.active !== undefined) h.active = body.active
      return HttpResponse.json(h)
    }),
  ),

  http.get('/api/categories', ({ request }) => {
    const all = new URL(request.url).searchParams.get('include_inactive') === 'true'
    return HttpResponse.json({ items: categories.filter((c) => all || c.active) })
  }),
  http.post(
    '/api/categories',
    reviewerOnly(async ({ request }) => {
      const body = (await request.json()) as CategoryCreateRequest
      const label = body.label?.trim() ?? ''
      if (label.length < 2) return error(400, 'VALIDATION_ERROR', 'Name is too short.')
      if (categories.some((c) => c.label.toLowerCase() === label.toLowerCase()))
        return error(409, 'CATEGORY_EXISTS', 'A category with this name already exists.')
      const cat: Category = {
        key: categoryKey(label),
        label,
        label_ur: body.label_ur?.trim() || null,
        keywords: body.keywords ?? [],
        builtin: false,
        active: true,
        created_at: new Date().toISOString(),
      }
      categories.push(cat)
      return HttpResponse.json(cat, { status: 201 })
    }),
  ),
  http.patch(
    '/api/categories/:key',
    reviewerOnly(async ({ params, request }) => {
      const cat = categories.find((c) => c.key === params.key)
      if (!cat) return error(404, 'NOT_FOUND', 'Category not found.')
      const body = (await request.json()) as CategoryPatchRequest
      if (body.active === false && cat.key === 'other')
        return error(409, 'CATEGORY_LOCKED', "The 'Other' category can't be turned off.")
      if (body.label) cat.label = body.label.trim()
      if (body.label_ur !== undefined) cat.label_ur = body.label_ur?.trim() || null
      if (body.keywords) cat.keywords = body.keywords
      if (body.active !== undefined) cat.active = body.active
      return HttpResponse.json(cat)
    }),
  ),

  // Calls (§16): the mock has no speech model; a typed stand-in or the reviewer supplies text.
  http.post('/api/simulator/call', async ({ request }) => {
    await delay(700)
    if (!DEMO_MODE) return error(404, 'NOT_FOUND', 'Simulator is only available in demo mode.')
    const form = await request.formData()
    const hint = String(form.get('transcript_hint') ?? '').trim()
    const rec = createReport({
      text: hint,
      channel: 'call',
      from: String(form.get('from') ?? ''),
      placeText: null,
      point: null,
      hasImage: false,
    })
    const r = rec.report
    const to = normPhone(String(form.get('to') ?? ''))
    const line = helplines.find((h) => h.number === to || h.provider_number === to)
    if (to && !line)
      return error(400, 'VALIDATION_ERROR', 'That number is not a registered helpline.')
    r.call = {
      helpline: line ? { number: line.number, label: line.label } : null,
      duration_seconds: 12,
      has_audio: false,
      audio_url: null,
      transcript_status: hint ? 'succeeded' : 'failed',
      transcript_model: hint ? 'typed-demo-transcript' : null,
      transcript_error: hint ? null : 'No speech model is configured. Type the transcript.',
    }
    if (!hint) {
      r.extraction = emptyExtraction('failed', 0, 'Waiting for a transcript.')
      rec.pendingPolls = 0
    }
    const ref = r.reference
    const reply =
      `Shukriya! Aap ki call record ho gayi hai (${ref}). Ek volunteer isay sun kar review karega.\n` +
      `Thank you, call ${ref} recorded. In a life-threatening emergency, call 1122.`
    return HttpResponse.json({ report_id: r.id, reference: ref, reply })
  }),
  http.put(
    '/api/reports/:id/transcript',
    reviewerOnly(async ({ params, request }) => {
      const rec = record(String(params.id))
      if (!rec) return error(404, 'NOT_FOUND', 'Report not found.')
      const r = rec.report
      if (r.channel !== 'call' || !r.call)
        return error(409, 'NOT_A_CALL', 'Only call reports have a transcript.')
      const body = (await request.json()) as TranscriptRequest
      r.source_text = body.text.trim()
      r.masked_text = maskText(r.source_text)
      r.call = {
        ...r.call,
        transcript_status: 'manual',
        transcript_model: 'reviewer',
        transcript_error: null,
      }
      r.extraction = emptyExtraction('pending')
      rec.pendingPolls = 3
      audit(r, 'edit_transcript', null)
      return HttpResponse.json(refresh(rec))
    }),
  ),
]
