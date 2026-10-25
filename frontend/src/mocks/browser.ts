import { setupWorker } from 'msw/browser'
import { handlers, persistDb } from './handlers'

export const worker = setupWorker(...handlers)

worker.events.on('response:mocked', () => persistDb())
