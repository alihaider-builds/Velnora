/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
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

// `npm run build:standalone`: inline the single JS bundle and stylesheet into the HTML so the
// whole app is one file (dist-standalone/relieflens-demo.html) that opens from disk.
// Runs after Vite has written its files (so its own placeholders are already filled in).
function singleFileHtml(outDir: string): Plugin {
  return {
    name: 'relieflens-single-file',
    apply: 'build',
    closeBundle() {
      const read = (p: string) => readFileSync(join(outDir, p), 'utf8')
      let page = read('index.html')
      page = page.replace(/<script[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g, (_m, src: string) => {
        const code = read(src).replace(/<\/script/gi, '<\\/script')
        return `<script type="module">${code}</script>`
      })
      page = page.replace(
        /<link[^>]*rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g,
        (_m, href: string) => `<style>${read(href)}</style>`,
      )
      const favicon = readFileSync('public/favicon.svg').toString('base64')
      page = page.replace(/href="[^"]*favicon\.svg"/, `href="data:image/svg+xml;base64,${favicon}"`)
      for (const name of readdirSync(outDir))
        rmSync(join(outDir, name), { recursive: true, force: true })
      writeFileSync(join(outDir, 'relieflens-demo.html'), page)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  if (mode === 'standalone') {
    return {
      base: './',
      publicDir: false, // the one file needs nothing from public/ (offline voice models stay out)
      plugins: [react(), tailwindcss(), singleFileHtml('dist-standalone')],
      build: {
        outDir: 'dist-standalone',
        emptyOutDir: true,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        cssCodeSplit: false,
        chunkSizeWarningLimit: 10_000,
        rolldownOptions: { output: { inlineDynamicImports: true } },
      },
    }
  }

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
