import { CheckCircle2, Map as MapIcon, PlusCircle } from 'lucide-react'
import { Link, useParams } from 'react-router'

export function SubmitDone() {
  const { reference = '' } = useParams()

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <div className="card flex flex-col items-center gap-4 p-8 text-center">
        <CheckCircle2 size={44} className="text-verified" aria-hidden="true" />
        <h1 className="text-2xl font-bold">Report received</h1>
        <p className="text-muted">Your reference is</p>
        <p
          className="rounded-lg bg-surface-2 px-4 py-2 font-mono text-2xl font-bold tracking-wider"
          dir="ltr"
        >
          {reference}
        </p>
        <p>A reviewer will check it before anything appears on the map.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link to="/submit" className="btn">
            <PlusCircle size={16} aria-hidden="true" /> Submit another
          </Link>
          <Link to="/" className="btn btn-primary">
            <MapIcon size={16} aria-hidden="true" /> View map
          </Link>
        </div>
      </div>
    </div>
  )
}
