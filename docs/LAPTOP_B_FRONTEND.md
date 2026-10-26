# Laptop B — Frontend & UI/UX (start here)

> **v2 changes (26 Oct) — these override anything below:**
> - **No AI ranking.** The priority score and the AI urgency suggestion are removed. The review queue is
>   ordered by time (newest first, oldest first on request); the reviewer sets urgency and can filter by it.
> - **Helpline calls.** Calls are recorded (with a recording notice), transcribed by Gemma 4 when installed,
>   or typed by the reviewer after listening; then extracted like any message. The simulator has a Call tab.
> - **Help categories** are managed by the organizer from the dashboard (name, Urdu name, keywords); the AI
>   uses the active list.
> - **Location:** better place extraction (e.g. "Lalkurti, Cantt, Rawalpindi"), broader-query map search,
>   Google Maps tiles + Google geocoding when keys are set (OpenStreetMap otherwise), and manual entry of
>   coordinates or a pasted Google Maps link.
> - The API contract is `BACKEND_TECH_SPEC.md` §4 (updated); the code in `backend/` and `frontend/` matches it.

You build **Module B** of ReliefLens: every screen people see — the submit form, the SMS/WhatsApp simulator, the reviewer's priority list and report screen with evidence highlighting, and the public map. Laptop A builds the backend at the same time; you work against mock data until it's ready.

---

## 1. Read these, in this order
1. [`PRD.md`](PRD.md) — what the product does, user stories, checkpoints. (15 min)
2. [`UI_UX_SPEC.md`](UI_UX_SPEC.md) — **your full spec**: design system, every screen, accessibility, mocks.
3. [`BACKEND_TECH_SPEC.md`](BACKEND_TECH_SPEC.md) **§4** — the API contract. Your `types.ts` must match it exactly. Also skim §16.3 (reply text) and §17 (how priority is calculated) so the UI explains them correctly.

---

## 2. What you own
| You own | You don't touch |
|---|---|
| `frontend/` | `backend/`, `eval/`, `data/` |

Shared: `docs/` and `README.md` — change them only through small pull requests.

---

## 3. Set up (before Sunday 10:00 if possible)
- [ ] Node.js 20 LTS (or newer), Git.
- [ ] Create the Vite + React + TypeScript app in `frontend/`; add Tailwind, React Router, TanStack Query, MapLibre GL, MSW, Lucide.
- [ ] Load fonts: Inter and **Noto Nastaliq Urdu**; check an Urdu sentence renders right-to-left without clipped letters.
- [ ] Pick a basemap that needs no key (e.g. OpenFreeMap) and note its attribution text.
- [ ] Get Laptop A's Wi-Fi IP for `VITE_API_TARGET`.

`.env.local` (not committed):
```
VITE_USE_MOCKS=true                  # switch to false at C2
VITE_API_TARGET=http://<laptop-A-ip>:8000
```

---

## 4. Your tasks, in order
Tick each one and open a pull request for it (`feat/frontend-<topic>`). Laptop A reviews and merges.

| # | Task | Spec | Done by |
|---|---|---|---|
| 1 | Skeleton: routing, design tokens (§3), header, demo banner, Vite `/api` proxy | §2–§4 | **C1 Sun 12:00** |
| 2 | `types.ts` mirroring backend §4, API client, MSW mocks + fixtures (§9) | §9 | C1 |
| 3 | Submit page + confirmation | §5.2 | C2 |
| 4 | **SMS & WhatsApp simulator** | §5.2a | **C2 Sun 18:00** |
| 5 | **Priority list** queue: priority + channel badges, filters, summary strip, polling | §5.4 | C2–C3 |
| 6 | Report detail: header (channel, sender, priority "Why?"), original text, AI suggestions with **evidence highlighting**, extraction states | §5.5 | C3 |
| 7 | Action bar (approve / reject / flag / urgency), sign-in page + route guard | §5.3, §5.5 | C3 |
| 8 | Public map with approved pins and stats | §5.1 | **C3 Sun 24:00** |
| 9 | Location picker (candidates, drag pin, confirm) | §5.5 | C4 |
| 10 | Duplicates panel, compare dialog, merge | §5.5 | **C4 Mon 06:00** |
| 11 | Edit fields, audit timeline, dashboard, keyboard shortcuts | §5.5, §5.6 | C4–C5 |
| 12 | Accessibility pass, Urdu check, mobile check, screenshots + GIF for README | §7, §8, §11 | **C5 Mon 09:00** |

**If time runs short:** finish 1–8 first. That alone makes a working demo.

---

## 5. Rules that protect the project
- **Never invent API fields.** If you need something the contract lacks, ask Laptop A and update §4 in a pull request first.
- Evidence offsets are **code points**: slice with `Array.from(text)`, never `text.slice()`.
- Always label AI values "AI suggestion"; never say a photo "proves" anything.
- Public pages never show report text, sender numbers, quantities or images.
- Status and priority are never shown by colour alone — always icon + word.
- Use generic chat icons and the word "WhatsApp"; no WhatsApp logo.

---

## 6. Checkpoints with Laptop A
| Checkpoint | Your part |
|---|---|
| **C1 Sun 12:00** | App runs on mocks; `types.ts` matches §4 |
| **C2 Sun 18:00** | Set `VITE_USE_MOCKS=false`; submit from the form and the simulator to the real backend; reports appear in the queue |
| **C3 Sun 24:00** | Evidence highlighting on real Gemma output; priority list; approve → pin on public map |
| **C4 Mon 06:00** | Location picker, duplicates, sign-in all working against the real API |
| **C5 Mon 09:00** | Freeze: only fixes, screenshots and demo rehearsal |

At each checkpoint, run the PRD §9 success scenario together.

---

## 7. Prompt to start your coding assistant (Claude Code or Kiro)
> We are building Module B (frontend and UI/UX) of ReliefLens. Read `docs/PRD.md`, `docs/UI_UX_SPEC.md`, `docs/BACKEND_TECH_SPEC.md` §4 and `docs/LAPTOP_B_FRONTEND.md`. Follow the task order in `LAPTOP_B_FRONTEND.md` §4, one task per branch and pull request. Use mock data (MSW) that matches the API contract exactly until we switch to the real backend. Only edit `frontend/`. Start with task 1.

For Kiro: also save the generated requirements, design and tasks under `.kiro/specs/frontend/`, and note what Kiro generated for the README's "How we used Kiro" section.

---

## 8. Definition of done (your module)
- [ ] Every screen in UI/UX spec §4 exists and handles loading, empty and error states.
- [ ] Simulator sends SMS and WhatsApp messages and shows the bilingual reply with a reference.
- [ ] Queue is ordered by priority, with readable "Why?" reasons.
- [ ] Clicking each AI field highlights exactly the right words in the demo sentence; unmatched evidence shows a warning.
- [ ] Approve is blocked until a location is confirmed.
- [ ] Urdu renders right-to-left in Nastaliq; the review screen works by keyboard alone.
- [ ] Public map shows no personal details; demo banner visible on every page.
- [ ] Works at 1280 × 800 and on a phone; screenshots and a GIF saved for the README.
