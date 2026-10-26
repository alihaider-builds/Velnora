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

## Tests, lint and evaluation

```bash
pytest                       # 62 tests; no GPU, model or network needed
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
