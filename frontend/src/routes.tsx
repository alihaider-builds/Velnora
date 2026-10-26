import { lazy, Suspense } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { Layout, RouteError } from './components/Layout'
import { RequireReviewer } from './components/RequireReviewer'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { NotFound } from './pages/NotFound'
import { PublicMap } from './pages/PublicMap'
import { ReportDetail } from './pages/ReportDetail'
import { ReviewQueue } from './pages/ReviewQueue'
import { Submit } from './pages/Submit'
import { SubmitDone } from './pages/SubmitDone'

// The SMS / WhatsApp / call simulator is a developer testing tool, not a user feature: it is
// not linked in the navigation, and in production builds its route redirects to /submit, so
// its (lazily split) code is never loaded.
// eslint-disable-next-line react-refresh/only-export-components -- route table, not a component module
const DevSimulator = lazy(() => import('./pages/Simulator').then((m) => ({ default: m.Simulator })))

/** Routes — UI_UX_SPEC.md §4. `devTools` enables developer-only pages (the simulator). */
export function buildRoutes({ devTools }: { devTools: boolean }): RouteObject[] {
  return [
    {
      element: <Layout />,
      errorElement: <RouteError />,
      children: [
        { path: '/', element: <PublicMap /> },
        { path: '/submit', element: <Submit /> },
        { path: '/submit/done/:reference', element: <SubmitDone /> },
        {
          path: '/simulator',
          element: devTools ? (
            <Suspense fallback={null}>
              <DevSimulator />
            </Suspense>
          ) : (
            <Navigate to="/submit" replace />
          ),
        },
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
  ]
}
