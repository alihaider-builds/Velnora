import { QueryClientProvider } from '@tanstack/react-query'
import { Tooltip } from 'radix-ui'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { queryClient } from './api/queryClient'
import { Layout, RouteError } from './components/Layout'
import { RequireReviewer } from './components/RequireReviewer'
import { ToastProvider } from './components/Toast'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { NotFound } from './pages/NotFound'
import { PublicMap } from './pages/PublicMap'
import { ReportDetail } from './pages/ReportDetail'
import { ReviewQueue } from './pages/ReviewQueue'
import { Simulator } from './pages/Simulator'
import { Submit } from './pages/Submit'
import { SubmitDone } from './pages/SubmitDone'

// Routes — UI_UX_SPEC.md §4.
const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <PublicMap /> },
      { path: '/submit', element: <Submit /> },
      { path: '/submit/done/:reference', element: <SubmitDone /> },
      { path: '/simulator', element: <Simulator /> },
      { path: '/review/login', element: <Login /> },
      {
        element: <RequireReviewer />,
        children: [
          { path: '/review', element: <ReviewQueue /> },
          { path: '/review/reports/:id', element: <ReportDetail /> },
          { path: '/review/dashboard', element: <Dashboard /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])

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
