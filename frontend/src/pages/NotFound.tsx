import { Link } from 'react-router'

export function NotFound() {
  return (
    <section className="px-4 py-6">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted">The page you are looking for does not exist.</p>
      <ul className="mt-4 flex flex-wrap gap-3">
        <li>
          <Link to="/" className="inline-flex min-h-11 items-center text-primary underline">
            Map
          </Link>
        </li>
        <li>
          <Link to="/submit" className="inline-flex min-h-11 items-center text-primary underline">
            Submit a report
          </Link>
        </li>
      </ul>
    </section>
  )
}
