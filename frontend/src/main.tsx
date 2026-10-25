import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { USE_MOCKS } from './lib/config'

async function start() {
  // UI_UX_SPEC §9: MSW serves contract-shaped fixtures until the backend is ready.
  if (USE_MOCKS) {
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
