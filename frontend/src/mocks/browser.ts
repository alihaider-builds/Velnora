import { setupWorker } from 'msw/browser'
import { categoryHandlers, handlers, persistDb } from './handlers'

export const worker = setupWorker(...categoryHandlers, ...handlers)

worker.events.on('response:mocked', () => persistDb())
