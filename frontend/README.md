# ReliefLens — frontend (Module B)

React 18 + TypeScript + Vite. Spec: [`../docs/UI_UX_SPEC.md`](../docs/UI_UX_SPEC.md); tasks:
[`../docs/LAPTOP_B_FRONTEND.md`](../docs/LAPTOP_B_FRONTEND.md); API contract:
[`../docs/BACKEND_TECH_SPEC.md`](../docs/BACKEND_TECH_SPEC.md) §4.

## Run

Requires **Node.js 22.22.2+ (22 LTS), 24.15+ (24 LTS) or 26+** — the `engines` range in
`package.json`. It is the strictest range across the installed tools: Vite 8 and ESLint 10 need
Node 20.19+/22.13+, Vitest 5 needs 22.12+, and jsdom (used by `npm run test`) needs 22.22.2+ or
24.15+. Odd-numbered releases (23, 25) are not supported by Vitest and jsdom.

```sh
npm install
cp .env.example .env.local   # then edit
npm run dev                  # http://localhost:5173
```

| Variable                      | Meaning                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `VITE_USE_MOCKS`              | `true`: MSW serves contract-shaped fixtures in the browser. `false`: real backend. |
| `VITE_API_TARGET`             | Backend the dev server proxies `/api` to (default `http://localhost:8000`).        |
| `VITE_MOCK_REVIEWER_PASSWORD` | Mock mode only: password the mock accepts (default `demo`). Not a real secret.     |
| `VITE_MOCK_DEMO_MODE`         | Mock mode only: `false` simulates a backend with demo mode off.                    |

All API calls use relative `/api/...` paths with `credentials: "include"`, so the session cookie
works through the proxy without CORS. Both `npm run dev` and `npm run preview` (the production
build) proxy `/api` to `VITE_API_TARGET`.

`.env.production` sets `VITE_USE_MOCKS=false`, so `npm run build` never ships mock mode even if
`.env.local` enables it for development. For a deliberate offline mock-demo build, override it in
`.env.production.local` (git-ignored) or the shell.

### Mock mode

- Seed data covers every case in UI_UX_SPEC §9: the demo sentence with code-point offsets, an Urdu
  report, unmatched evidence, a pending extraction that completes after 3 polls, a failed extraction,
  duplicates, a prompt-injection report, all three channels, a repeat sender and every priority level.
- Mock state lives in `sessionStorage`, so it survives reloads; close the tab to reset it.
- A map search containing the word `unavailable` returns `502` to show the fallback message.
- Mock results are not evidence that the live backend works — test against it at C2.

## Scripts

| Command                | What it does                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| `npm run dev`          | Dev server with hot reload                                         |
| `npm run build`        | Type-check and production build                                    |
| `npm run preview`      | Serve the production build                                         |
| `npm run test`         | Vitest: code-point slicing, evidence highlight, priority, fixtures |
| `npm run lint`         | ESLint                                                             |
| `npm run format`       | Format with Prettier                                               |
| `npm run format:check` | Check formatting without writing                                   |

## Map

Basemap: [OpenFreeMap](https://openfreemap.org) (no API key), `positron` style in light mode and
`dark` in dark mode. Attribution — OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors —
is shown on every map and in the public map's side panel.
