import { QueryClientProvider } from '@tanstack/react-query'
import { Tooltip } from 'radix-ui'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { queryClient } from './api/queryClient'
import { ToastProvider } from './components/Toast'
import { buildRoutes } from './routes'

const router = createBrowserRouter(buildRoutes({ devTools: import.meta.env.DEV }))

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
