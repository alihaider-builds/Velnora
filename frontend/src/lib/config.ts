/** VITE_USE_MOCKS=true → MSW serves fixtures (UI_UX_SPEC §9); false → the real backend. */
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

/** Key-free basemap (LAPTOP_B_FRONTEND §3). Attribution comes from the style's tile source. */
export const BASEMAP_STYLE = {
  // "liberty" shows water, parks and roads in colour, so the map is easier to read than grey.
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

/** Pakistan, used when a report has no suggested location (UI_UX_SPEC §5.5). */
export const PAKISTAN_CENTER: [number, number] = [69.35, 30.38]
export const PAKISTAN_ZOOM = 4.3

/** Backend accepts submitter pins only inside Pakistan's bounding box (§4.4 POST /api/reports). */
export const PAKISTAN_BOUNDS = { minLat: 23.5, maxLat: 37.1, minLng: 60.8, maxLng: 77.9 }
