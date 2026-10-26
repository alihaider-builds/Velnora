/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// MapLibre's web worker must reach the browser untouched. Served through Vite's dev pipeline it
// gets an `import "/@vite/client"` prepended, which crashes inside a worker and leaves every map
// blank ("Worker failed to load"). So the file is served as-is in dev and copied as-is into builds.
const WORKER_PATH = '/maplibre-gl-worker.mjs'
function maplibreWorker(): Plugin {
  const file = createRequire(import.meta.url).resolve('maplibre-gl/dist/maplibre-gl-worker.mjs')
  return {
    name: 'relieflens-maplibre-worker',
    configureServer(server) {
      server.middlewares.use(WORKER_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript')
        res.end(readFileSync(file))
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: WORKER_PATH.slice(1), source: readFileSync(file) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  // All API calls use relative /api/... paths (UI_UX_SPEC §2). Both the dev server and
  // `vite preview` (the production build) forward them to the backend on Laptop A, so the
  // session cookie stays same-origin in either mode.
  const proxy = {
    '/api': {
      target: env.VITE_API_TARGET || 'http://localhost:8000',
      changeOrigin: true,
    },
  }

  // No cross-origin isolation headers (COOP/COEP): they would let the offline speech engine use
  // several threads, but they stop MapLibre from loading map tiles (the map stays blank).
  return {
    plugins: [react(), tailwindcss(), maplibreWorker()],
    server: { proxy },
    preview: { proxy },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test-setup.ts'],
    },
  }
})
