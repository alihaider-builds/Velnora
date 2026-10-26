# ReliefLens backend (Module A)

FastAPI service for ReliefLens: report intake (web form, SMS, WhatsApp, demo simulator), Gemma 4 extraction with evidence grounding, the priority list, map search, duplicate suggestions, review workflow and the privacy-filtered public API.

Full spec: [`docs/BACKEND_TECH_SPEC.md`](../docs/BACKEND_TECH_SPEC.md) (§4 is the API contract the frontend uses).
Interactive API docs while running: <http://localhost:8000/api/docs>

## Quick start (Windows, macOS, Linux)

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"

# from the repo root, create your local settings (never committed)
cp ../.env.example ../.env
```

Then, in `.env` at the repo root:
1. Set `SESSION_SECRET` and `SENDER_HASH_SECRET` to long random strings:
   `python -c "import secrets;print(secrets.token_urlsafe(32))"`
2. Set the reviewer password: run `python -m app.auth hash-password` and paste the output into `REVIEWER_PASSWORD_HASH`.

```bash
python -m app.seed --reset                         # 30 synthetic reports, 6 approved for the map
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` lets the frontend laptop on the same Wi-Fi reach `http://<this-laptop-ip>:8000`.

## Using Gemma 4

By default `LLM_BACKEND=fake`: an offline keyword fallback with the same output format, so everything works without a model. Its output shows the model name `fake-heuristic`; it is not the product's AI.

To use Gemma 4:
1. Install [Ollama](https://ollama.com) and pull a Gemma 4 model (see the [Gemma + Ollama guide](https://ai.google.dev/gemma/docs/integrations/ollama)). Start with the E4B size.
2. Check the exact tag with `ollama list` and set `OLLAMA_MODEL` to it.
3. Set `LLM_BACKEND=ollama`, restart, and check `GET /api/health` shows `"model_available": true`.
4. Re-run `python -m app.seed --reset` and `python ../eval/run_eval.py` to get real Gemma numbers.

The model sits behind one interface (`app/services/llm/`), so it can be swapped without touching the rest of the app.

## SMS and WhatsApp

- **Demo:** `POST /api/simulator/send` (demo mode only) goes through exactly the same code as real messages.
- **Real channels (optional):** set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `PUBLIC_BASE_URL` (a tunnel such as `cloudflared tunnel --url http://localhost:8000`), then point Twilio's incoming-message webhooks at `/api/inbound/sms` and `/api/inbound/whatsapp`. Every request's Twilio signature is verified. See spec §16.4.

### SMS to your own helpline SIM with textbee (recommended)
[textbee](https://textbee.dev) (open source) runs on the Android phone with the helpline SIM and forwards each SMS to `/api/inbound/textbee`.
1. Create a free account at textbee.dev; in its dashboard **Register device** shows a QR code: scan it with the textbee app on the helpline phone. Allow SMS access and switch on **Receive SMS**.
2. Copy the **API key** from the textbee dashboard.
3. Start the tunnel: `cloudflared tunnel --url http://localhost:8000`.
4. ReliefLens **Dashboard → SMS to the helpline number → textbee**: paste the tunnel address and the API key, click **Connect**. This creates the textbee `MESSAGE_RECEIVED` webhook with `TEXTBEE_SIGNING_SECRET` from `.env` (re-connecting after a tunnel restart moves the same webhook).
5. Optional reply SMS: `TEXTBEE_REPLY=true` and `TEXTBEE_API_KEY` in `.env`.

Webhooks are verified (`X-Signature` = hex HMAC-SHA256 of the raw body) and idempotent on textbee's `idempotencyKey`.

### SMS to your own helpline SIM (Android SMS gateway, free)
An ordinary SIM can't send texts to a server by itself, so an Android phone holding the helpline SIM runs the open-source
[SMS Gateway for Android](https://sms-gate.app) app, which forwards every received SMS to `/api/inbound/sms-gateway`.
1. Install the app on the phone with the helpline SIM, allow SMS access, and turn on **Cloud Server** (it shows a username and password).
2. Expose the backend over HTTPS: `cloudflared tunnel --url http://localhost:8000` (the gateway needs a valid certificate).
3. In the app, **Settings → Webhooks → Signing Key**: set it to the `SMS_GATEWAY_SIGNING_KEY` value from `.env` (or copy the app's key into `.env`). Restart the backend.
4. Register the webhook: easiest from the **Dashboard → SMS to the helpline number** panel (paste the tunnel address and the app's username/password, click Connect; old tunnel addresses are replaced). Or by hand:
   `curl -u USER:PASS --json '{"url":"https://<tunnel>/api/inbound/sms-gateway","event":"sms:received"}' https://api.sms-gate.app/3rdparty/v1/webhooks`
5. Optional reply with the reference number: `SMS_GATEWAY_REPLY=true`, `SMS_GATEWAY_USERNAME`, `SMS_GATEWAY_PASSWORD` in `.env` (sent from the helpline SIM at normal SMS rates).

Each forwarded SMS is checked (HMAC-SHA256 signature, timestamp within 5 minutes), stored as an `sms` report and extracted; gateway retries never create duplicates.

**Tunnel safety:** requests that come through Cloudflare (`cf-ray` / `cf-connecting-ip` headers) can only reach `/api/inbound/*`; sign-in, reports and everything else answer `403 TUNNEL_PATH_BLOCKED` (`TUNNEL_INBOUND_ONLY=true`, the default). The panel shows the last forwarded SMS and the 24-hour count.

## Helpline calls and transcription

- **Real calls (optional):** point a Twilio number's voice webhook at `/api/inbound/voice`. Callers hear a recording notice, leave a message after the beep, and the recording arrives at `/api/inbound/voice/recording`.
- **Helpline numbers:** the organizer adds them on the dashboard. A normal mobile number (e.g. a Jazz/Zong SIM) can't send calls to a server by itself: forward its calls to your Twilio number and enter that number as "Forwards to". Calls are matched to the helpline and the report shows which line was called.
- **Demo:** the simulator's Call tab records from the microphone (or takes an audio file) and posts it to `/api/simulator/call`.
- **Transcription with Gemma 4:** `pip install -e ".[audio]"`, then `TRANSCRIBER_BACKEND=gemma`. Gemma 4 E2B/E4B transcribe speech through Hugging Face Transformers (not Ollama), 30 seconds at a time, so calls are split into 30-second chunks. The first run downloads several GB.
- **Without a speech model:** recordings are kept, the report shows "Needs transcript", and the reviewer listens and types it. The AI then reads the text as usual.

## Help categories

Six built-ins are created automatically. The organizer adds more from the dashboard (name, Urdu name, keywords people use); the AI only uses active categories. API: `GET/POST /api/categories`, `PATCH /api/categories/{key}`.

## Maps and place search

- `GOOGLE_MAPS_API_KEY` (server) switches place search to Google's Geocoding API; the frontend's `VITE_GOOGLE_MAPS_API_KEY` (browser key) switches the basemap to Google map tiles. Without keys everything uses OpenStreetMap.
- If a full place phrase finds nothing, broader versions are tried: "Lalkurti, Cantt, Rawalpindi" → "Cantt, Rawalpindi" → "Rawalpindi".
- The public "Where?" field suggests places as you type (Google Places Autocomplete with a key; otherwise [Photon](https://photon.komoot.io) on OpenStreetMap data, since Nominatim forbids autocomplete). `GET /api/places/suggest?q=`.
- Reviewers can always click the map, drag the pin, or type coordinates / paste a Google Maps link.

## Tests, lint and evaluation

```bash
pytest                       # 107 tests; no GPU, model or network needed
ruff check app tests ../eval
python ../eval/run_eval.py   # writes eval/results.md  (add --geocode to test map search)
```

CI runs the same steps on every push and pull request (`.github/workflows/backend.yml`).

## Layout

```
app/
  main.py, factory.py     app setup, middleware, routers
  config.py               settings from .env
  db.py                   SQLite tables
  schemas.py              API models (mirror spec §4)
  repo.py                 response building (report, list item, public projection)
  auth.py                 reviewer sign-in, session cookie, password hashing
  routers/                health, auth, reports (submit + review), public, geocode, inbound
  services/
    llm/                  Gemma via Ollama, offline fallback, prompt, output schema
    extraction.py         validate -> retry once -> evidence grounding
    evidence.py, normalize.py
    priority.py           priority score (spec §17)
    duplicates.py         duplicate scoring with gates and reasons
    geocoding.py          Nominatim, cached, 1 request/s
    channels.py           one intake path for every channel, auto-reply text
    privacy.py, storage.py, audit.py, jobs.py
  seed.py                 load synthetic samples
tests/                    pytest suite
```

## Privacy and safety in the code

- Public endpoints return only approved reports: needs, a shortened area label, coordinates rounded to about 1 km, and the approval time.
- Phone numbers in report text are masked (same length, so evidence offsets still line up); sender numbers are masked and only revealed through a logged endpoint.
- Uploaded images are checked by content, limited to 5 MB, and re-encoded to drop EXIF/GPS metadata.
- The model has no tools; its output is schema-validated; only reviewer actions change status or urgency.
- Report text and phone numbers are never logged.

## Known limitations

- Image storage is local only (`STORAGE_BACKEND=s3` is not implemented yet — a good first issue).
- Duplicate suggestions are computed when read, which is fine for hundreds of reports, not millions.
- Thresholds and the fallback's keyword lists were tuned on the team's synthetic samples.
