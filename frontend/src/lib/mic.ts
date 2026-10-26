// Shared microphone checks and messages for voice typing, voice notes and the call simulator.

/** Why the microphone can't be used at all on this page, or null when it can be tried. */
export function micUnavailableReason(): string | null {
  if (typeof window === 'undefined') return null
  // Browsers only allow the microphone on https:// pages and on localhost. Opening the app from
  // a phone at http://192.168.x.x is the usual cause of "the microphone doesn't work".
  if (!window.isSecureContext)
    return `The microphone only works on a secure page. Open ReliefLens at http://localhost:5173 on this computer, or over https:// on a phone. You can type your report instead.`
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
    return "This browser can't record audio. Try the latest Chrome, Edge, Firefox or Safari, or type your report."
  return null
}

/** A plain-language message for a failed getUserMedia call. */
export function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Click the lock or site-settings icon next to the address, allow the microphone, then try again.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Connect one (or check it is switched on), then try again.'
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone is being used by another app (for example Zoom, Teams or WhatsApp). Close it, then try again.'
    default:
      return (
        micUnavailableReason() ??
        "The microphone couldn't be started. Try again, or type your report."
      )
  }
}

/** Opens the microphone with echo/noise clean-up, which helps speech recognition on laptops. */
export function openMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
}
