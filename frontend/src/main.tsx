import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { USE_MOCKS } from './lib/config'

async function start() {
  if (import.meta.env.VITE_STANDALONE === 'true') {
    // One-file offline demo: mock backend inside the page (see standalone.ts).
    const { startStandalone } = await import('./standalone')
    startStandalone()
  } else if (USE_MOCKS) {
    // UI_UX_SPEC §9: MSW serves contract-shaped fixtures until the backend is ready.
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass', quiet: true })
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
