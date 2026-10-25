/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCKS?: string
  readonly VITE_API_TARGET?: string
  /** Mock mode only: the password the MSW mock accepts (default "demo"). Not a real credential. */
  readonly VITE_MOCK_REVIEWER_PASSWORD?: string
  /** Mock mode only: "false" simulates a backend with demo mode off. */
  readonly VITE_MOCK_DEMO_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
