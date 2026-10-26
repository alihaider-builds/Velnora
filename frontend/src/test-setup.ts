import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom does not implement layout APIs; stub the ones components call.
Element.prototype.scrollIntoView = function scrollIntoView() {}

// Vitest globals are off, so Testing Library can't unmount between tests on its own.
afterEach(() => cleanup())
