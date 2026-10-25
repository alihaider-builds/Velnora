/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

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

  return {
    plugins: [react(), tailwindcss()],
    server: { proxy },
    preview: { proxy },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test-setup.ts'],
    },
  }
})
