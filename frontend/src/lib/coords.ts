import { PAKISTAN_BOUNDS } from './config'

/**
 * Reads a location typed or pasted by a person:
 *   "33.5808, 73.0558"   "33.5808 73.0558"
 *   Google Maps links such as ".../@33.5808,73.0558,17z" or "...?q=33.5808,73.0558"
 * Returns null when nothing usable is found; `error` explains why.
 */
export function parseCoords(input: string): { lat: number; lng: number } | { error: string } {
  const text = input.trim()
  if (!text) return { error: 'Enter coordinates or paste a map link.' }
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, // google.com/maps/@lat,lng,zoom
    /[?&](?:q|ll|query|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
    /^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/, // "lat, lng" or "lat lng"
  ]
  for (const re of patterns) {
    const m = re.exec(text)
    if (!m) continue
    const lat = Number(m[1])
    const lng = Number(m[2])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const b = PAKISTAN_BOUNDS
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng)
      return {
        error: 'That point is outside Pakistan. Check the order: latitude first, then longitude.',
      }
    return { lat, lng }
  }
  return { error: 'Use "latitude, longitude" (e.g. 33.5808, 73.0558) or paste a Google Maps link.' }
}
