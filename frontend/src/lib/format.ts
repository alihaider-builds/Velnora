const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'long' })

/** "12 min ago", "3 hours ago", "yesterday". */
export function relativeTime(iso: string, now = Date.now()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(diffSec)
  if (abs < 45) return 'just now'
  if (abs < 3600) {
    const min = Math.round(diffSec / 60)
    return Math.abs(min) === 1 ? rtf.format(min, 'minute') : `${Math.abs(min)} min ago`
  }
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  return rtf.format(Math.round(diffSec / 86400), 'day')
}

/** Exact local time for hover titles. */
export function exactTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** "09:21" — used in the audit timeline. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** '+923260175097' -> '+92 326 0175097'; other numbers are returned unchanged. */
export function formatPhone(number: string): string {
  const m = /^\+92(\d{3})(\d{7})$/.exec(number)
  return m ? `+92 ${m[1]} ${m[2]}` : number
}
