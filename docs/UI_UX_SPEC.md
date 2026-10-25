# ReliefLens — Module B: UI/UX & Frontend Specification

| | |
|---|---|
| **Module** | B — Frontend & UI/UX |
| **Built on** | Laptop B |
| **Owns folder** | `frontend/` |
| **Related** | [`PRD.md`](PRD.md) · [`BACKEND_TECH_SPEC.md`](BACKEND_TECH_SPEC.md) — **§4 is the API contract this module consumes** |

This module never invents API shapes. Every request and response follows `BACKEND_TECH_SPEC.md` §4. Until the backend is ready, build against mock data that matches it exactly (§9).

---

## 1. Design principles

1. **AI suggests, humans decide — and the UI shows the difference.** Every AI value carries an "AI suggestion" marker; reviewer-confirmed values look different.
2. **Evidence one click away.** Any AI field can be traced to the exact words in the original message.
3. **Calm under pressure.** Coordinators are busy and tired: clear hierarchy, few colours, no clutter, large targets.
4. **Private by default.** Phone numbers are masked; original text and images are behind an explicit "Reveal" action; the public map never shows text.
5. **Language-respectful.** Urdu script renders right-to-left in a proper Nastaliq font; Roman Urdu and English render left-to-right; mixed text is handled per block.
6. **Never colour alone.** Status always pairs colour with an icon and a word.

---

## 2. Technology

| Concern | Choice |
|---|---|
| Framework | React 18 + TypeScript + Vite |
| Routing | React Router |
| Server state | TanStack Query (caching, polling for extraction status) |
| Styling | Tailwind CSS with design tokens from §3 as CSS variables |
| Components | Headless primitives (Radix UI or similar) for dialogs, tabs, toasts, dropdowns — accessible by default |
| Map | MapLibre GL JS. Basemap with no API key (e.g. OpenFreeMap) or a keyed provider; follow its terms and show its attribution |
| Mocking | MSW (Mock Service Worker) serving fixtures that match §4 |
| Icons | Lucide |
| Fonts | Inter (Latin), Noto Nastaliq Urdu (Urdu script), via Google Fonts or self-hosted |
| Tests (if time) | Vitest + Testing Library for evidence highlighting and review actions |
| Lint | ESLint + Prettier, run in CI |

**API access:** all calls go to relative `/api/...`. In development, Vite proxies `/api` to the backend (`VITE_API_TARGET`, default `http://localhost:8000`, or Laptop A's IP). Requests use `credentials: "include"` so the session cookie is sent.

```
frontend/
  src/
    api/          client.ts (fetch wrapper, error format), types.ts (mirrors §4), hooks.ts (TanStack Query)
    mocks/        handlers.ts (MSW), fixtures/*.json
    components/   EvidenceText, FieldCard, StatusBadge, NeedChip, AiBadge, MapView, LocationPicker,
                  DuplicateCard, CompareDialog, ActionBar, AuditTimeline, DemoBanner, EmptyState
    pages/        PublicMap, Submit, SubmitDone, Login, ReviewQueue, ReportDetail, Dashboard, NotFound
    styles/       tokens.css
    lib/          text.ts (code-point slicing, direction detection), format.ts
```

---

## 3. Visual design system

### 3.1 Colour tokens
Defined as CSS variables on `:root`, with a dark theme under `@media (prefers-color-scheme: dark)`. All text pairs meet WCAG AA (4.5:1).

| Token | Light | Use |
|---|---|---|
| `--bg` | `#F7F8FA` | Page background |
| `--surface` | `#FFFFFF` | Cards, panels |
| `--text` | `#14171F` | Body text |
| `--text-muted` | `#5B6475` | Secondary text |
| `--border` | `#E2E5EC` | Dividers |
| `--primary` | `#1F5FBF` | Primary buttons, links, focus ring |
| `--ai` | `#7A4FD6` | AI-suggestion marker (dashed outline + "AI" badge) |
| `--verified` | `#1E8E5A` | Reviewer-verified / approved |
| `--pending` | `#B7791F` | Pending review |
| `--flagged` | `#C2410C` | Flagged |
| `--rejected` | `#B42318` | Rejected, destructive actions |
| `--merged` | `#64748B` | Merged |
| `--historical` | `#8A94A6` | Historical context layer |
| `--highlight` | `#FFE58F` | Evidence highlight background |

### 3.1a Priority levels and channels
Priority badges are **filled** pills (white text); status badges are **outlined** pills, so the two never look alike even where colours are close.

| Priority level | Token | Colour | Icon | Label |
|---|---|---|---|---|
| `critical` | `--p-critical` | `#9F1239` | `siren` | Critical |
| `high` | `--p-high` | `#C2410C` | `arrow-up` | High |
| `medium` | `--p-medium` | `#A16207` | `minus` | Medium |
| `low` | `--p-low` | `#475569` | `arrow-down` | Low |

| Channel | Icon (Lucide) | Label |
|---|---|---|
| `web` | `globe` | Web form |
| `sms` | `message-square` | SMS |
| `whatsapp` | `message-circle` | WhatsApp |

Use generic icons and the text "WhatsApp"; do not use the WhatsApp logo (trademark).

### 3.2 Need categories (chip colour + icon + label)
| Category | Label (EN / UR) | Icon |
|---|---|---|
| `food` | Food / خوراک | `utensils` |
| `clean_water` | Clean water / صاف پانی | `droplet` |
| `shelter` | Shelter / پناہ | `home` |
| `medicine` | Medicine / دوا | `pill` |
| `evacuation` | Evacuation / انخلا | `truck` |
| `other` | Other / دیگر | `circle-help` |

### 3.3 Information layers
These four layers must never look the same:

| Layer | Visual treatment | Label text |
|---|---|---|
| Reported (submitter's words) | Plain text in a quote panel | "Reported" |
| AI suggestion | Dashed `--ai` outline + small "AI" badge | "AI suggestion" |
| Reviewer-verified | Solid `--verified` outline + check icon | "Verified by reviewer" |
| Historical context (P2) | Grey hatched map layer | "Historical context — not proof" |

### 3.4 Typography and spacing
- Inter 16 px body, 14 px secondary, 20/24/30 px headings; line height 1.5.
- Urdu script: Noto Nastaliq Urdu at 1.15× size with line height 2.0 (Nastaliq needs vertical room).
- 4 px spacing scale; cards 16–24 px padding; 8 px radius.
- Minimum touch target 44 × 44 px.

### 3.5 Direction handling
- Every user-text block uses `dir="auto"` so the browser picks the direction from the first strong character.
- `lib/text.ts` exposes `hasUrduScript(text)` (Arabic block U+0600–U+06FF, U+0750–U+077F) to apply the Nastaliq font class.
- UI chrome stays left-to-right (English interface); the language toggle (P1) only switches labels.

---

## 4. Navigation and routes

| Route | Access | Page |
|---|---|---|
| `/` | Public | Public map |
| `/submit` | Public | Submit a report |
| `/submit/done/:reference` | Public | Confirmation |
| `/simulator` | Public, **demo mode only** | SMS & WhatsApp simulator |
| `/review/login` | Public | Reviewer sign-in |
| `/review` | Reviewer | Review queue |
| `/review/reports/:id` | Reviewer | Report detail (the core screen) |
| `/review/dashboard` | Reviewer | Dashboard |
| `*` | Public | Not found |

**Header (all pages):** ReliefLens logo + tagline · "Map" · "Submit a report" · "Simulator" (demo mode only) · "Review" (shows "Sign out" when signed in).
**Demo banner (when `/api/health` returns `demo_mode: true`):** a slim bar under the header: *"Demo data — all reports here are synthetic."* Not dismissible.
**Guarding:** reviewer routes call `GET /api/auth/me`; on `401`, redirect to `/review/login?next=<path>`.

---

## 5. Screens

### 5.1 Public map (`/`)
**Purpose:** show verified needs by area, with no personal details.

**Layout (desktop):** full-height map on the right (≈70%); left panel (≈30%) with:
- Title "Verified needs" and the total approved count.
- Need filter chips (multi-select) — P1.
- Counts by need (small horizontal bars) from `GET /api/public/stats`.
- Top areas list.
- Footer: "Only reviewer-approved reports appear. Locations are approximate (about 1 km)." plus data and map attribution.

**Layout (mobile):** map full screen; the panel becomes a bottom sheet with a drag handle.

**Map pins:** one circle marker per `PublicReport`, coloured by the first need, with a small number when clustered. Click → popup: need chips, area label, "Approved <relative time>", "Demo data" tag if synthetic. **No text, quantities or images.**

**States:** loading skeleton on the panel; empty: "No verified reports yet." with a link to submit; error: inline retry.

**Data:** `GET /api/public/reports`, `GET /api/public/stats`; refetch every 30 s.

### 5.2 Submit a report (`/submit`)
**Purpose:** let anyone send a report quickly in their own language. Mobile-first.

**Form fields (single column):**
1. **"What is happening and what is needed?"** — large textarea, `dir="auto"`, placeholder in Roman Urdu and English (*"Misal: Hamare gaon mein pani aa gaya hai, 5 bachay hain, dawai chahiye"*). Character counter 10–2,000.
2. **"Where?"** — text input for a place name (optional), with helper text "Village, area or landmark".
3. **"Or pick on the map"** — button that opens a small map dialog to drop a pin (optional). Shows the chosen coordinates with a "Remove" link.
4. **"Photo (optional)"** — file picker, JPG/PNG/WebP up to 5 MB, preview thumbnail, remove button. Helper text: "Only reviewers can see photos. Location data in the photo is removed."
5. **Demo checkbox** (visible when `demo_mode`): "This is a test/demo report" — checked and disabled in demo mode.
6. **Privacy note** above the button: "Don't include ID numbers. Phone numbers are hidden from the public."
7. **Submit** button — disabled until the text is valid; shows a spinner while sending.

**Client validation** mirrors the backend: text length, image type/size, both or neither of lat/lng.

**On success:** navigate to `/submit/done/:reference` showing "Report received — reference RL-3F9A. A reviewer will check it before anything appears on the map." with "Submit another" and "View map" buttons. **The submitter never sees AI output.**

**Errors:** `400` → inline field errors; `413`/`415` → message under the photo field; `429` → "Too many reports from this connection. Try again in a minute."

### 5.2a SMS & WhatsApp simulator (`/simulator`) — demo mode only
**Purpose:** let judges send reports "by SMS or WhatsApp" without a real phone, through the same backend path as real messages.

**Layout:** a phone-shaped frame (about 360 × 720 px) centred on the page, with a side note explaining: *"Simulated phone. Messages go through the same path as real SMS and WhatsApp messages. Demo data only."* On mobile, the frame fills the screen.

**Inside the phone:**
- **Channel tabs** at the top: *SMS* · *WhatsApp*. WhatsApp uses a green-tinted chat background; SMS uses grey bubbles — styled generically, with no WhatsApp logo.
- **"From" number** field (prefilled with a fake number, e.g. `+92 300 0000001`, editable; a "New sender" button generates another fake number).
- **Conversation view:** sent messages on the right, automatic replies on the left with time stamps. `dir="auto"` per bubble.
- **Composer:** text box + Send. **Quick-fill chips** above it for the demo: *Roman Urdu flood message*, *Urdu message*, *Duplicate with different spelling*, *Injection attempt*.
- On send: `POST /api/simulator/send`, show the user's bubble immediately, then the `reply` bubble ("Shukriya! … RL-3F9A …").
- Under the reply, a small link **"Open in review queue"** (goes to `/review/reports/:id`, which asks for sign-in if needed).

**States:** sending spinner on the bubble; error bubble "Not delivered — tap to retry"; `404` (demo mode off) → the page shows "Simulator is only available in demo mode."

Conversations are kept in component state only (cleared on reload).

### 5.3 Reviewer sign-in (`/review/login`)
Single password field ("Reviewer password"), "Sign in" button, error "Incorrect password" on `401`, "Too many attempts, wait a minute" on `429`. On success, go to `next` or `/review`.

### 5.4 Review queue (`/review`) — the priority list
**Purpose:** triage incoming reports fast, most urgent first.

**Top bar:** status tabs with counts — *Pending* (default) · *Flagged* · *Approved* · *Rejected* · *Merged* · *All*; search box (`q`); filters for need, **channel** and **priority level**; sort (**Priority** (default) · Newest · Oldest).

**Priority summary strip** above the list: four counters — Critical · High · Medium · Low — each clickable as a filter.

**List rows** (`ReportListItem`), ordered by priority score:
| Element | Detail |
|---|---|
| Priority | Filled priority badge (level + score, e.g. "Critical · 75"); hover/focus shows the reasons list |
| Channel | Channel icon + label (Web form / SMS / WhatsApp) |
| Preview | First 80 chars of masked text, `dir="auto"`, Nastaliq for Urdu |
| Language badge | "Roman Urdu" / "اردو" / "English" / "Mixed" |
| Needs | Need chips (AI or corrected) |
| Place | Place text or "No place" in muted text |
| Extraction | Spinner "Reading…" (pending/running), red "Extraction failed" badge (failed) |
| Duplicates | "2 possible duplicates" badge when `duplicate_count > 0` |
| Location | Pin icon filled if confirmed, outline if not |
| Status | Status badge (colour + icon + word) |
| Time | Relative time ("12 min ago") with exact time on hover |

Click a row → report detail. Keyboard: `J`/`K` move selection, `Enter` opens. Pagination at the bottom (25 per page). Rows with pending extraction poll every 2 s until they settle. The whole list refetches every 30 s so waiting-time points stay current; when a row moves up, it briefly highlights (no animation if `prefers-reduced-motion`).

**Explaining the order:** a small "How is priority calculated?" link opens a popover: *"Priority combines the AI's urgency suggestion (or your own urgency once set), the most serious need, and how long the report has been waiting. It only orders your work — it never sends anything."*

**Empty state:** "No reports waiting. New submissions will appear here."

### 5.5 Report detail (`/review/reports/:id`) — the core screen
**Layout (≥1280 px): three columns + sticky action bar.**

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ← Queue  RL-3F9A · [WhatsApp] +92 3•• ••• ••41 · Roman Urdu · 32 min ago   │
│          [Critical · 75] [Pending] [Demo data]   Why? ▸ reasons            │
├─────────────────────┬─────────────────────────┬───────────────────────────┤
│ 1. ORIGINAL REPORT  │ 2. AI SUGGESTIONS       │ 3. LOCATION               │
│ "Reported"          │ [AI] Needs              │ Map with candidates       │
│                     │  ▢ Medicine  "dawai"    │ ● Pir Baba, Buner (best)  │
│ Buner mein pani     │  ▢ Clean water          │ ○ Buner District          │
│ ghar mein aa gaya,  │ [AI] Quantities         │ [Search again] [Drop pin] │
│ 5 bachay hain,      │  ▢ 5 children "5 bachay"│ [Confirm location]        │
│ [dawai] aur saaf    │ [AI] Place  Buner       │───────────────────────────│
│ pani chahiye.       │ [AI] Time   —           │ 4. POSSIBLE DUPLICATES    │
│ Rabta 03••-•••••••  │ [AI] Urgency  high      │ 0.82 · same needs ·       │
│ [Reveal original]   │ ⚠ Uncertainties         │ 1.2 km · 3 h  [Compare]   │
│ [Photo thumbnail]   │ [Edit fields]           │                           │
├─────────────────────┴─────────────────────────┴───────────────────────────┤
│ Urgency [unknown ▾]  Note [__________]  [Flag] [Reject] [Merge…] [Approve]│
└───────────────────────────────────────────────────────────────────────────┘
```
On narrower screens (768–1279 px) columns 2 and 3 stack; under 768 px everything stacks with the action bar fixed at the bottom.

#### Header — channel, sender and priority
- Channel badge and, for SMS/WhatsApp, the masked sender number. If `sender.same_sender_count > 0`: "This number sent 2 other reports in the last 24 h" (links to a filtered queue).
- Priority badge with a **"Why?"** toggle that lists `priority.reasons`. When `urgency_source` is `ai_suggestion`, the reason reads "AI suggests…"; once the reviewer sets urgency, it reads "Reviewer set urgency…".

#### Column 1 — Original report
- Shows `masked_text` inside a quote panel labelled **"Reported"**, `dir="auto"`, Nastaliq when Urdu. For SMS/WhatsApp, the panel is styled as a message bubble with the channel icon.
- **"Reveal original"** button calls `GET /api/reports/{id}/original` and swaps in the unmasked text and full sender number, with a note "Viewing original — this action is logged."
- Photo thumbnail (if `has_image`), click to enlarge in a dialog; caption "Submitted photo — not proof of the situation."
- Submitter's own place text and pin (if any) shown under the text as "Submitter said: …".

#### Column 2 — AI suggestions
- Section header with the **AI badge** and model name: "AI suggestions (Gemma 4) — check before approving."
- **Field cards** (`FieldCard`) for needs, quantities, place, time, urgency suggestion. Each card shows the value and its evidence phrase in quotes.
- **Evidence interaction (core feature):**
  - Hover or keyboard focus on a field card → its phrase highlights in Column 1 (`--highlight` background, `<mark>` element) and scrolls into view.
  - Click → highlight stays pinned until another field is clicked or `Esc` is pressed.
  - Each field type uses the same highlight colour; the active highlight also gets an underline so it doesn't rely on colour.
  - Use **code-point slicing** (`Array.from(text)`) with `start`/`end` from the API.
  - `matched: false` → card shows a warning icon and "Evidence not found — check manually". No highlight.
- **Uncertainties** list with a warning icon.
- **Extraction states:**
  - `pending`/`running`: skeleton cards and "Gemma is reading the report…" (poll every 2 s, give up after 120 s with a retry button).
  - `failed`: error message, **Retry extraction** button (`POST /retry-extraction`) and **Fill in manually** (opens the edit form empty).
  - Offline demo (`model` shows the fake backend): a small tag "Pre-generated example".
- **Edit fields:** opens an inline form — need multi-select, quantity rows (value + label), place text, time text. Save → `PATCH /fields`. Corrected values render with the **verified** treatment and a small "AI said: …" line underneath, so the change stays visible.

#### Column 3 — Location
- Map centred on the suggested location (or Pakistan if none).
- **Candidate list** from `GET /api/geocode?q=<place>` (auto-run with the extracted or corrected place); each candidate is a radio row with label and type; the selected one shows on the map.
- **Search again** box to change the query.
- **Drop pin / drag pin:** clicking the map or dragging the marker sets a manual pin (`source: "reviewer_pin"`), labelled "Reviewer-provided location".
- **Confirm location** button → `POST /location`. After confirming, the panel shows a verified badge with the label, and "Change" to reopen the picker.
- If the geocoder fails (`502`): "Map search is unavailable — drop a pin on the map instead."

#### Column 3 (below) — Possible duplicates
- From `GET /duplicates`. Each `DuplicateCard` shows the score as a bar (not just a number), the reasons as bullet chips, the other report's need chips, place and time.
- **Compare** opens a side-by-side dialog of both reports' masked text and fields.
- **Merge into this one** (in the dialog) → confirmation dialog: "Merge RL-… into RL-…? The merged report stays in the record and can't be approved separately." → `POST /merge`.
- Empty: "No likely duplicates found."

#### Sticky action bar
- **Urgency** select (low / medium / high / unknown) — the reviewer's decision, separate from the AI suggestion. Shows "AI suggested: high" beside it until the reviewer chooses. Changing it updates the priority score on the next refetch.
- **Note** text input (≤500 chars).
- Buttons: **Flag**, **Reject** (destructive style, confirm dialog), **Merge…** (opens duplicate picker), **Approve** (primary).
- **Approve is disabled until a location is confirmed**, with the tooltip "Confirm a location first". If the API still returns `409 LOCATION_REQUIRED`, show that message.
- After any action, toast confirmation and move to the next pending report (option "Stay on this report").
- `approved`/`rejected` reports show a **Reopen** button instead.
- Keyboard shortcuts (shown in a `?` help dialog): `A` approve, `R` reject, `F` flag, `M` merge, `E` edit fields, `L` focus location search, `1`–`9` focus field cards, `Esc` clear highlight, `J`/`K` next/previous report. Shortcuts are disabled while typing in an input.

#### Audit timeline (P1)
Collapsible section at the bottom: each `AuditEntry` as a timeline row ("09:21 · Reviewer approved · Note: …").

### 5.6 Dashboard (`/review/dashboard`) — P1
- KPI tiles: pending, flagged, approved, rejected, extraction failures (from `GET /api/stats`).
- Priority tiles: critical, high, medium, low (pending and flagged only).
- Reports by channel: web form, SMS, WhatsApp.
- Bar chart: approved reports by need.
- Table: top areas by approved count.
- Link "Open public map".

### 5.7 Not found and errors
- 404 page with links to Map and Submit.
- Global error boundary: "Something went wrong" with a reload button.
- Network-down banner when requests fail repeatedly: "Can't reach the server — retrying…".

---

## 6. Microcopy rules
- Say **"AI suggestion"**, never "AI says" or "detected".
- Say **"Reported"** for submitter content and **"Verified by reviewer"** for approved data.
- Never say a photo "shows" or "proves" anything.
- Plain, short sentences; no jargon such as "geocoder" in the UI — use "map search".
- Buttons are verbs: "Approve", "Confirm location", "Retry extraction".

---

## 7. Accessibility checklist
- All interactive elements reachable and operable by keyboard, with a visible focus ring (`--primary`, 2 px).
- Field cards are buttons with `aria-describedby` pointing to the evidence phrase; the highlighted `<mark>` has an accessible name ("Evidence for Medicine").
- Status badges include text, not only colour; icons have `aria-hidden` with a text label beside them.
- Dialogs trap focus and close with `Esc`; toasts use `aria-live="polite"`.
- Map: every pin action is also available from a list (candidates, duplicates), so the map is never the only way.
- `lang="ur"` on Urdu-script blocks, so screen readers pick the right voice.
- Respect `prefers-reduced-motion` (no fly-to animations).

---

## 8. Responsive behaviour
| Width | Behaviour |
|---|---|
| < 768 px | Single column; submit form optimised for phones; detail page stacks with a bottom action bar |
| 768–1279 px | Detail page: two columns (original + AI), location and duplicates below |
| ≥ 1280 px | Detail page: three columns + sticky action bar (target layout for the demo) |

No horizontal page scrolling at any width; 16 px side gutters on mobile.

---

## 9. Mock-first development
Laptop B starts before the backend is ready:
1. `src/api/types.ts` mirrors every shape in `BACKEND_TECH_SPEC.md` §4 exactly (names, enums, nullability).
2. MSW handlers in `src/mocks/handlers.ts` implement every endpoint with fixtures, including:
   - a succeeded Roman Urdu report (the demo sentence) with correct code-point offsets;
   - an Urdu-script report;
   - a report with `matched: false` evidence;
   - a pending extraction that flips to succeeded after 3 polls;
   - a failed extraction;
   - a report with two duplicate candidates;
   - a prompt-injection report;
   - `409 LOCATION_REQUIRED` and `401` responses;
   - reports from all three channels (web, SMS, WhatsApp) with masked senders, one sender with `same_sender_count: 2`;
   - priorities at every level, with reasons, so the queue order is visible;
   - `POST /api/simulator/send` returning a reference and the bilingual reply text from `BACKEND_TECH_SPEC.md` §16.3.
3. Toggle with `VITE_USE_MOCKS=true|false`. At Checkpoint C2, switch to the real backend and keep mocks for offline demos and tests.
4. When the backend's OpenAPI is stable, optionally regenerate `types.ts` from `/api/openapi.json` (e.g. `openapi-typescript`) and diff against the hand-written version.

**Demo fixture offsets** (code points, end-exclusive) for *"Buner mein pani ghar mein aa gaya, 5 bachay hain, dawai aur saaf pani chahiye."*:

| Phrase | start | end |
|---|---|---|
| `Buner` | 0 | 5 |
| `5 bachay` | 35 | 43 |
| `dawai` | 50 | 55 |
| `saaf pani` | 60 | 69 |

For any other fixture, compute offsets with a script (`Array.from(text)`), never by hand.

---

## 10. Build order for Module B

| # | Task | Checkpoint |
|---|---|---|
| 1 | Vite + TS + Tailwind + Router skeleton, tokens, header, demo banner | C1 |
| 2 | `types.ts`, API client, MSW mocks + fixtures | C1 |
| 3 | Submit page + confirmation | C2 |
| 4 | **SMS & WhatsApp simulator** | C2 |
| 5 | Review queue as **priority list** (priority badges, channel badges, filters, polling) | C2–C3 |
| 6 | Report detail: header (channel, sender, priority "Why?"), Column 1 + Column 2 with **evidence highlighting** and extraction states | C3 |
| 7 | Action bar (approve/reject/flag, urgency), sign-in + route guard | C3 |
| 8 | Public map with approved pins and stats | C3 |
| 9 | Location picker (candidates, drag pin, confirm) | C4 |
| 10 | Duplicates panel, compare dialog, merge | C4 |
| 11 | Edit fields, audit timeline, dashboard, keyboard shortcuts | C4–C5 |
| 12 | Accessibility pass, Urdu rendering check, mobile check, screenshots/GIF for README | C5 |

---

## 11. Demo polish checklist
- [ ] Simulator: a WhatsApp message gets the bilingual reply with a reference, and appears near the top of the priority list.
- [ ] Priority badge "Why?" shows readable reasons, and the score rises as the report waits.
- [ ] The demo sentence highlights each phrase precisely when its field is clicked.
- [ ] Urdu-script report renders right-to-left in Nastaliq without clipped glyphs.
- [ ] Prompt-injection report shows normal suggestions and urgency unchanged.
- [ ] Approve is blocked until location is confirmed, with a clear reason.
- [ ] Public map popup shows no text, quantities or images.
- [ ] Demo-data banner visible on every page.
- [ ] Works at 1280 × 800 (projector) and on a phone for the submit page.
- [ ] Screenshots and a short GIF of the review flow saved for the README.

---

## 12. Kiro usage (Module B)
1. Paste this spec (and §4 of the backend spec) into Kiro on Laptop B; generate requirements, design and tasks into `.kiro/specs/frontend/`.
2. Implement task by task on `feat/frontend-*` branches.
3. Review generated components by hand, especially evidence offset handling, auth redirects and anything that might display raw text publicly.
4. Record what Kiro generated and what was changed, for the README's "How we used Kiro" section.
