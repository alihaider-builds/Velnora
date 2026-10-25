# Laptop A — Backend, AI & Data (start here)

You build **Module A** of ReliefLens: the FastAPI backend, the Gemma 4 extraction, SMS/WhatsApp intake, the priority list logic, data and tests. Laptop B builds the frontend against your API at the same time.

---

## 1. Read these, in this order
1. [`PRD.md`](PRD.md) — what the product does, user stories, checkpoints. (15 min)
2. [`BACKEND_TECH_SPEC.md`](BACKEND_TECH_SPEC.md) — **your full spec**. §4 is the API contract Laptop B depends on. §16 is SMS/WhatsApp, §17 is the priority score.
3. [`UI_UX_SPEC.md`](UI_UX_SPEC.md) §5 only — so you know how your responses are shown.

---

## 2. What you own
| You own | You don't touch |
|---|---|
| `backend/`, `eval/`, `data/`, `docker-compose.yml`, `.env.example` | `frontend/` |

Shared: `docs/` and `README.md` — change them only through small pull requests.

---

## 3. Set up (before Sunday 10:00 if possible)
- [ ] Python 3.12, Git, Docker Desktop.
- [ ] Ollama installed; pull a Gemma 4 model and confirm its exact tag with `ollama list`. Try the E4B size first.
- [ ] Quick check that Gemma handles Roman Urdu: send it the demo sentence and see whether it finds *dawai* and *saaf pani*. **If it struggles, tell Laptop B and adjust the prompt early.**
- [ ] Note your laptop's Wi-Fi IP address; Laptop B will point its dev server at `http://<your-ip>:8000`.
- [ ] (Optional, P1) Twilio account for real SMS/WhatsApp; `cloudflared` for the tunnel. **Don't let this block anything — the simulator covers the demo.**

---

## 4. Your tasks, in order
Tick each one and open a pull request for it (`feat/backend-<topic>`). Laptop B reviews and merges.

| # | Task | Spec | Done by |
|---|---|---|---|
| 1 | App skeleton, settings, DB tables, `/api/health`, error format, `.env.example`, `.gitignore` | §3, §9, §10 | **C1 Sun 12:00** |
| 2 | `POST /api/reports`, `GET /api/reports`, `GET /api/reports/{id}` with `FakeLLMClient` | §4.4, §5.6 | **C2 Sun 18:00** |
| 3 | 30 synthetic reports + fixtures + `python -m app.seed` | §11 | C2 |
| 4 | **Simulator** endpoint + shared `create_report_from_channel` + reply text | §16 | C2 |
| 5 | Ollama client, prompt, schema validation, retry | §5 | C3 |
| 6 | Evidence matching + normalization | §5.4, §6.1 | C3 |
| 7 | **Priority score** + `sort=priority` | §17 | C3 |
| 8 | Review actions, status rules, audit, public API + privacy filter | §4.4, §4.5, §8 | **C3 Sun 24:00** |
| 9 | Sign-in (login/logout/me) + protected routes | §4.4, §8 | C3–C4 |
| 10 | Geocoding + location endpoints | §7 | C4 |
| 11 | Duplicates (incl. same sender) + merge | §6.2 | C4 |
| 12 | Image upload, EXIF removal, WhatsApp media | §8, §16.2 | C4 |
| 13 | Real SMS/WhatsApp webhooks with signature check | §16.2 | C4 |
| 14 | CI (ruff + pytest with fake LLM), eval script, `eval/results.md`, Docker Compose | §11, §12, §13 | **C4 Mon 06:00** |
| 15 | (P1) Live Twilio number / WhatsApp sandbox via tunnel | §16.4 | After C4 |

**If time runs short:** finish 1–8 first. That alone makes a working demo.

---

## 5. Rules that protect the project
- **Never change the API contract (§4) without telling Laptop B first** and updating the spec in a pull request.
- AI output is a suggestion: only reviewer actions change `status` and `urgency`.
- Public endpoints return only the `PublicReport` shape — no text, numbers, images.
- Never commit `.env`, the database, uploads or model files.
- Never log report text, phone numbers or passwords.
- Tests must run in CI with `LLM_BACKEND=fake` — no GPU, Ollama or network.

---

## 6. Checkpoints with Laptop B
| Checkpoint | Your part |
|---|---|
| **C1 Sun 12:00** | `/api/health` running; confirm §4 is final; share your IP |
| **C2 Sun 18:00** | B submits through the form and the simulator, and sees reports in the queue (fake extraction is fine) |
| **C3 Sun 24:00** | Real Gemma extraction with evidence offsets, priority list, approve → public map |
| **C4 Mon 06:00** | Location, duplicates, sign-in, tests, CI all green |
| **C5 Mon 09:00** | Freeze: only fixes, eval numbers and docs |

At each checkpoint, run the PRD §9 success scenario together.

---

## 7. Prompt to start your coding assistant (Claude Code or Kiro)
> We are building Module A (backend, AI and data) of ReliefLens. Read `docs/PRD.md`, `docs/BACKEND_TECH_SPEC.md` and `docs/LAPTOP_A_BACKEND.md`. Follow the task order in `LAPTOP_A_BACKEND.md` §4, one task per branch and pull request. Implement the API exactly as in `BACKEND_TECH_SPEC.md` §4 — do not change any request or response shape. Only edit `backend/`, `eval/`, `data/` and `docker-compose.yml`. Start with task 1.

For Kiro: also save the generated requirements, design and tasks under `.kiro/specs/backend/`, and note what Kiro generated for the README's "How we used Kiro" section.

---

## 8. Definition of done (your module)
- [ ] Every endpoint in §4 works and matches the contract.
- [ ] A WhatsApp message from the simulator becomes a report, gets a reply with a reference, and is extracted by Gemma with matched evidence.
- [ ] The priority list orders reports by score, with reasons, and scores rise with waiting time.
- [ ] The prompt-injection sample changes nothing.
- [ ] `pytest` passes locally and in CI; `ruff` clean.
- [ ] `eval/results.md` has real numbers with denominators.
- [ ] `docker compose up` + `python -m app.seed` gives a working app from a fresh clone.
- [ ] No secrets in git (`git log -p | grep -i token` finds nothing real).
