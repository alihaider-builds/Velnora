import { QueryClientProvider } from '@tanstack/react-query'
import { Tooltip } from 'radix-ui'
import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router'
import { queryClient } from './api/queryClient'
import { ToastProvider } from './components/Toast'
import { buildRoutes } from './routes'

// A file opened from disk has no server to resolve /review etc., so the one-file demo uses #/ URLs.
const createRouter =
  import.meta.env.VITE_STANDALONE === 'true' ? createHashRouter : createBrowserRouter
// The one-file demo also includes the simulator, which normal production builds leave out.
const router = createRouter(
  buildRoutes({ devTools: import.meta.env.DEV || import.meta.env.VITE_STANDALONE === 'true' }),
)

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={200}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </Tooltip.Provider>
    </QueryClientProvider>
  )
}
