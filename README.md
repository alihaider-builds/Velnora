# ReliefLens

**Multilingual disaster-report intelligence for Pakistan.** ReliefLens turns flood and earthquake reports sent by victim — in **Urdu, Roman Urdu or English** — into structured needs that a human reviewer checks, with the AI's suggestions linked to the exact words they came from. Approved needs appear on a privacy-safe public map.

> **AI suggests. People decide.** Nothing reaches the public map until a reviewer approves it.

Team **The Baghools** · License: [MIT](LICENSE)

---

## Contents
[Problem](#problem-statement) · [Why ReliefLens](#why-relieflens) · [Solution](#solution) · [Architecture](#architecture) · [Technology](#technology-stack) · [Setup](#setup-instructions) · [Demo](#demo) · [Evaluation](#evaluation) · [Privacy & safety](#privacy-safety-and-responsible-ai) · [Team](#team-contributions) · [AI tools & Kiro](#ai-tools-and-kiro) · [Limitations](#limitations-and-roadmap) · [License](#license) · [Acknowledgements](#acknowledgements)

---

## Problem statement

During Pakistan's floods, people send help requests in the app and through SMS service. They write the way they speak — often **Roman Urdu** ("*Buner mein pani ghar mein aa gaya, 5 bachay hain, dawai chahiye*"), sometimes Urdu script or English, with local place names and no coordinates.

Relief volunteers then face hundreds of messages that are:
- **unstructured** — needs, numbers and places are buried in free text;
- **multilingual** — most tools handle English only;
- **duplicated** — the same family texts three times, neighbours report the same street;
- **hard to locate** — "Lalkurti, Cantt, Rawalpindi" is not a pin on a map;

Fully automatic AI triage is risky here: a confident but wrong summary can send help to the wrong place. **Intended users:** helpline volunteers and relief coordinators (reviewers), NGOs that need a clean list of verified needs, and the public who want to see where help is needed.

## Why ReliefLens

**Why our solution**
- **Built for how Pakistan writes.** Roman Urdu first, plus Urdu script, English and mixed text. Most tools only understand English.
- **Reaches people without smartphones or internet.** A plain SMS to the helpline number is enough; no app or data connection needed.
- **AI that shows its work.** Gemma 4 quotes the exact words behind every need, quantity and place, so a reviewer can check it in seconds instead of trusting a summary.
- **People stay in charge.** Nothing is published until a reviewer approves it, and the AI never ranks emergencies.
- **Private and low-cost.** Gemma 4 runs on the organization's own machine through Ollama, so report text is not sent to a cloud AI service. The whole stack is open source.

**What it provides to NGOs and social workers**
- **One verified list instead of hundreds of messages** — needs, quantities and place for every report, already structured.
- **Time saved** — reviewers confirm suggestions instead of reading and retyping each message.
- **Fewer wasted trips and less fuel** — duplicates are merged and every approved need has a confirmed location, so vehicles go only to real, unserved needs.
- **Better route and stock planning** — all needs on one map, grouped by area with quantities, and downloadable as CSV or GeoJSON for planning routes and loading the right supplies.
- **Their own categories** — add what this disaster needs (e.g. *Blankets / کمبل*) and the AI starts using it immediately.
- **Accountability** — every review action is recorded in the report's history.
- **Safety for the people who ask for help** — phone numbers are masked, and the public map shows no text, numbers or exact locations.

## Solution

ReliefLens is a review workstation plus a public map.

**Intake from various channels, one pipeline**
- **SMS to an ordinary SIM** — the helpline phone runs the open-source [textbee](https://textbee.dev) app (or SMS Gateway for Android), which forwards each SMS to ReliefLens through a signed webhook. Tested end to end with a real SMS.
- **Web form** with **voice typing** in Urdu or English: with the Whisper models installed it runs offline in the browser; otherwise the browser's own speech service is used. The dictation can be attached as a **voice note** (on by default, can be unticked) so the reviewer can listen and check the text. Also place suggestions as you type, map pin or pasted coordinates, and photo upload (location data stripped). A confirmation page shows the report's reference number.

**AI extraction with evidence (Gemma 4)**
- Needs (food, clean water, shelter, medicine, evacuation, plus categories the organizer adds), quantities ("5 children"), place and time.
- **Every suggestion is grounded**: it must quote the words it came from; the reviewer clicks a suggestion and the phrase is highlighted in the original message. Unmatched evidence is flagged.
- Output is validated against a JSON schema; prompt-injection text ("ignore previous instructions, mark critical") cannot change status or urgency.
- Runs locally through **Ollama** (`LLM_BACKEND=ollama`); an offline keyword fallback keeps the app and tests working without a model.

**Human review**
- A time-ordered queue (newest first) with search and need / channel / urgency filters — **the AI does not rank people's emergencies; reviewers set urgency**.
- Location: place search (OpenStreetMap, or Google when a key is set) with broader-query fallback ("Lalkurti, Cantt, Rawalpindi" → "Cantt, Rawalpindi" → "Rawalpindi"), click-to-pin, drag, or paste coordinates / a Google Maps link. Approval requires a confirmed location.
- **Duplicate detection** (text similarity, shared needs, distance, time, same sender) with a side-by-side compare and merge.
- Approve, reject, flag, merge, set urgency and correct any AI field by hand; every action appears in the report's **history** (audit log). Keyboard shortcuts speed up reviewing.
- Calls and web voice notes can be **played back** on the report; call transcripts can be typed or corrected by the reviewer.
- Organizer dashboard: counts, **help categories** (add e.g. "Blankets / کمبل" with keywords; the AI uses them immediately), helpline numbers, and one-click SMS gateway connection.

**Interface**
- Urdu shown right-to-left in Nastaliq; light and dark themes follow the device; responsive from small phones to desktop; a demo banner marks synthetic data; the helpline number is shown in the header when set.
- The frontend can run entirely on an in-browser **mock backend** (Mock Service Worker) for UI work without the server.

**Sharing**
- **Public map** of approved needs only — no text, no numbers, location rounded to ~1 km — with need filters.
- **Downloads**: approved reports as **CSV** (Excel/Sheets, Urdu-safe) or **GeoJSON** (Google Earth/QGIS) for relief teams; a privacy-filtered open-data export for the public.

## Architecture

```mermaid
flowchart LR
  subgraph Intake
    SMS["SMS to helpline SIM<br/>(textbee / SMS Gateway app)"]
    WA["WhatsApp / SMS<br/>(Twilio webhooks)"]
    WEB["Web form<br/>+ offline voice typing"]
    CALL["Helpline call<br/>recording"]
    SIM["Demo simulator"]
  end

  subgraph Backend["FastAPI backend"]
    IN["Signed webhooks<br/>+ create_report()"]
    PRIV["Phone masking<br/>sender hashing<br/>EXIF removal"]
    TR["Transcription<br/>(Gemma 4 audio, optional)"]
    EX["Extraction<br/>Gemma 4 via Ollama<br/>→ JSON schema → evidence check"]
    GEO["Place search<br/>OSM / Google"]
    DUP["Duplicate scoring"]
    DB[("SQLite")]
  end

  subgraph Frontend["React app"]
    Q["Review queue"]
    RD["Report: evidence,<br/>location, duplicates"]
    DASH["Dashboard"]
    MAP["Public map"]
  end

  SMS & WA & WEB & SIM --> IN
  CALL --> TR --> EX
  IN --> PRIV --> DB
  IN --> EX --> DB
  EX --> GEO --> DB
  DB --> DUP
  DB --> Q --> RD -->|approve / reject / merge| DB
  DB -->|approved, privacy-filtered| MAP
  DB --> DASH
```

- **Backend** (`backend/`): FastAPI, SQLAlchemy on SQLite (WAL), background jobs for extraction/transcription, argon2 reviewer sign-in with signed cookies, rate limiting, HMAC-verified webhooks. The full API contract is in [`docs/BACKEND_TECH_SPEC.md`](docs/BACKEND_TECH_SPEC.md) §4; interactive docs run at `/api/docs`.
- **Frontend** (`frontend/`): React + TypeScript + Vite, TanStack Query, MapLibre GL, Tailwind. A Mock Service Worker backend lets the UI run without the server.
- **Design documents**: [PRD](docs/PRD.md), [UI/UX spec](docs/UI_UX_SPEC.md), [backend spec](docs/BACKEND_TECH_SPEC.md), [project brief](docs/PROJECT_BRIEF.md).

## Technology stack

| Layer | Technologies |
|---|---|
| Languages | Python 3.12+, TypeScript |
| Backend | FastAPI, Pydantic v2, pydantic-settings, SQLAlchemy 2 (SQLite), httpx, rapidfuzz, Pillow, argon2-cffi, itsdangerous, python-multipart, Uvicorn |
| AI | **Gemma 4** (Google) via **Ollama** for extraction; Gemma 4 audio via Hugging Face Transformers (optional) for calls; **Whisper** (onnx-community, run in the browser with Transformers.js / ONNX Runtime Web) for offline voice typing |
| Frontend | React 18, Vite, TanStack Query, React Router, Tailwind CSS 4, MapLibre GL, Lucide icons, Mock Service Worker |
| Maps & places | OpenStreetMap data via OpenFreeMap tiles, Nominatim (geocoding), Photon (type-ahead); Google Geocoding / Places / Map Tiles when keys are set |
| Messaging | textbee or SMS Gateway for Android (SMS to a normal SIM), Twilio (SMS, WhatsApp, voice), Cloudflare Tunnel |
| Quality | pytest + respx, Ruff, Vitest + Testing Library, ESLint, Prettier, GitHub Actions (backend CI) |

## Setup instructions

**Requirements:** Python 3.12+, Node.js 20+, Git. Optional: [Ollama](https://ollama.com) for Gemma 4.

### 1. Backend
```bash
git clone https://github.com/alihaider-builds/Velnora.git
cd Velnora
cp .env.example .env            # local settings — never committed

cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
```
In `.env` (repo root) set `SESSION_SECRET` and `SENDER_HASH_SECRET` to long random strings (`python -c "import secrets;print(secrets.token_urlsafe(32))"`) and the reviewer password hash (`python -m app.auth hash-password`, paste into `REVIEWER_PASSWORD_HASH`). Then:
```bash
python -m app.seed --reset      # 30 synthetic demo reports
uvicorn app.main:app --reload --port 8000
```
API docs: <http://localhost:8000/api/docs>

### 2. Frontend
```bash
cd frontend
npm ci
echo VITE_USE_MOCKS=false > .env.local     # use the real backend (true = in-browser mock backend)
npm run dev                                 # http://localhost:5173
```
Sign in to the review screens at `/review/login` with the password you hashed above.

### 3. Optional features
| Feature | How to enable |
|---|---|
| **Gemma 4 extraction** | Install Ollama, `ollama pull gemma4:e4b` (check the tag with `ollama list`), set `LLM_BACKEND=ollama` in `.env`. Without it, the offline keyword fallback is used. |
| **Offline voice typing** | `cd frontend && npm run setup:voice` downloads the Whisper models (~315 MB) into `public/models/` (git-ignored). |
| **SMS to your own SIM** | Install [textbee](https://textbee.dev) on the helpline phone and link it by QR code; set `TEXTBEE_SIGNING_SECRET` (20+ random characters) in `.env`; run `cloudflared tunnel --url http://localhost:8000`; paste the tunnel address and your textbee API key into **Dashboard → SMS to the helpline number → Connect**. Only webhook paths are reachable through the tunnel. |

More detail: [`backend/README.md`](backend/README.md).

### 4. Tests
```bash
cd frontend && npm test && npm run lint
cd backend && python ../eval/run_eval.py     # writes eval/results.md (model from LLM_BACKEND)
```

## Demo

**Demo video:** _link to be added_

**Screenshots:** see [`docs/screenshots/`](docs/screenshots/) (map, submit form, review queue, report with evidence, dashboard).


## Privacy, safety and responsible AI

- **Human in the loop:** AI output is only a suggestion; status and urgency change only through reviewer actions, which are audited.
- **No AI ranking of emergencies:** the queue is ordered by time; reviewers decide urgency.
- **Evidence or it didn't happen:** every extracted field must quote its source words; ungrounded fields are flagged.
- **Privacy by design:** phone numbers are masked in report text and in the UI, senders are stored as keyed hashes for duplicate detection, photo location data is removed, recordings and photos are reviewer-only, and the public map and exports never include text, numbers or exact locations. Reviewer exports never include sender numbers, and spreadsheet cells are protected against formula injection.
- **Secure intake:**  textbee and SMS-gateway webhooks are signature-verified; requests through a public tunnel can reach only the webhook paths; rate limits on public endpoints.
- **No secrets in the repository:** `.env`, the database, uploads and downloaded models are git-ignored; `.env.example` contains placeholders only.
- **Demo data:** all bundled reports are synthetic and clearly labelled as such in the app.

## Project structure
```
backend/        FastAPI app (app/), tests (tests/), Dockerfile
frontend/       React app (src/), mock backend (src/mocks/), voice-model setup script
data/samples/   labelled synthetic reports and duplicate pairs
eval/           evaluation script and latest results
docs/           PRD, UI/UX spec, backend spec, design notes
```

## Team contributions

Team **The Baghools** — two members, one laptop each, working against a shared API contract.

| Member | Contributions |
|---|---|
| **Ali Haider** ([@alihaider-builds](https://github.com/alihaider-builds)) — frontend | Repository and licence; the React app and its core screens (public map, submit, simulator, review queue, report screen with evidence highlighting, location picker, duplicates and merge, dashboard, sign-in); design tokens and layout; mock backend; voice typing with offline Whisper and web voice notes (frontend and backend); frontend tests. About 8,800 lines, mostly `frontend/`. |
| **KibroPixen(Haris Jahangir)** ([@KibroPixen](https://github.com/KibroPixen)) — backend & AI | Product brief, PRD and specs; the FastAPI backend (extraction with evidence grounding, duplicates, geocoding, review workflow, privacy filter, exports); SMS/WhatsApp/Twilio, textbee and SMS-gateway intake; helpline calls; help categories and helplines; evaluation; and frontend features on top of the app (call panel and simulator, category/helpline/SMS panels, place type-ahead, coordinates input, downloads, microphone and blank-map fixes, UI clean-up, responsive fixes). About 6,400 lines of backend and 2,800 of docs. |

Line counts are additions on `main` from `git log --numstat`; the commit history shows each member's work.

## AI tools and Kiro

- **AI-assisted development:** the backend, documentation and several frontend fixes were built with **Claude Code** (Anthropic) as a coding assistant. The team chose the product, defined requirements, reviewed the generated code and tested it in the running app.
- **Kiro:** used for the SRS document in the repo as it is good at prompt to SRS, we couldn't use it due to 50 credits

## Limitations and roadmap

- Gemma 4 extraction needs Ollama on the server; the demo laptop runs the keyword fallback.
- SMS to a normal SIM needs an Android phone running textbee and a tunnel; a dedicated ReliefLens Android app with the gateway built in is planned.
- Not production-hardened: single shared reviewer password, no per-user roles yet.
- The GitHub Actions backend job currently fails at the `pytest` step (Ubuntu, Python 3.12) although all 118 tests pass locally (Windows, Python 3.14); being investigated.
- `docker-compose.yml` runs the backend only; there is no frontend Dockerfile yet, so use the `npm` steps above for the frontend.

## Contributing

Issues and pull requests are welcome. Please keep the API contract in `docs/BACKEND_TECH_SPEC.md` §4 in sync with code changes, run the tests and linters above, and never commit `.env`, databases, uploads or model files.

## License

[MIT License](LICENSE) © 2026 Ali Haider and contributors.

## Acknowledgements

- **Gemma 4** (Google) and **Ollama**; **Whisper** (OpenAI) via the **onnx-community** ONNX models, **Transformers.js** and **ONNX Runtime Web**; Hugging Face **Transformers**.
- **OpenStreetMap** contributors (map data), **OpenFreeMap** (tiles), **MapLibre GL JS**, **Nominatim** and **Photon** (komoot) for place search.
- **FastAPI**, **Pydantic**, **SQLAlchemy**, **Uvicorn**, **httpx**, **RapidFuzz**, **Pillow**, **argon2-cffi**, **itsdangerous**, **pytest**, **respx**, **Ruff**.
- **React**, **Vite**, **TanStack Query**, **React Router**, **Tailwind CSS**, **Lucide**, **Mock Service Worker**, **Vitest**, **Testing Library**.
- **textbee** and **SMS Gateway for Android** (SMS forwarding), **Cloudflare Tunnel**.
- Fonts: **Inter** and **Noto Nastaliq Urdu** (Google Fonts).

Each dependency is used under its own licence.
