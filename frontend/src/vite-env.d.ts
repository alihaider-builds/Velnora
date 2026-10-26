/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCKS?: string
  readonly VITE_API_TARGET?: string
  /** Browser key for Google Map Tiles (restrict it to your site). Unset = OpenStreetMap. */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  /** Mock mode only: the password the MSW mock accepts (default "demo"). Not a real credential. */
  readonly VITE_MOCK_REVIEWER_PASSWORD?: string
  /** Mock mode only: "false" simulates a backend with demo mode off. */
  readonly VITE_MOCK_DEMO_MODE?: string
  /** "true" builds the one-file offline demo (npm run build:standalone). */
  readonly VITE_STANDALONE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
