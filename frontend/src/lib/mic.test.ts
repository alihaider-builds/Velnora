import { afterEach, describe, expect, it } from 'vitest'
import { micErrorMessage, micUnavailableReason } from './mic'

const setSecure = (value: boolean) =>
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value })

describe('microphone messages', () => {
  afterEach(() => setSecure(true))

  it('explains that phones on http:// cannot use the microphone', () => {
    setSecure(false)
    expect(micUnavailableReason()).toMatch(/only works on a secure page/)
    expect(micUnavailableReason()).toMatch(/localhost/)
  })

  it('maps browser errors to plain advice', () => {
    expect(micErrorMessage(new DOMException('x', 'NotAllowedError'))).toMatch(/blocked/)
    expect(micErrorMessage(new DOMException('x', 'NotFoundError'))).toMatch(/No microphone/)
    expect(micErrorMessage(new DOMException('x', 'NotReadableError'))).toMatch(/another app/)
  })
})
