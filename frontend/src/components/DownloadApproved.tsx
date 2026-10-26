import { Download } from 'lucide-react'

/** Download approved reports: CSV opens in Excel / Google Sheets, GeoJSON in Google Earth or QGIS.
 * `scope="review"` is the full reviewer export (no sender numbers); `scope="public"` is the same
 * privacy-filtered data as the public map. Plain links, so the browser handles the download. */
export function DownloadApproved({ scope }: { scope: 'review' | 'public' }) {
  const base = scope === 'review' ? '/api/reports/export' : '/api/public/export'
  const label = scope === 'review' ? 'Download approved' : 'Download data'
  return (
    <details className="relative">
      <summary className="btn btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <Download size={15} aria-hidden="true" /> {label}
      </summary>
      <div
        role="menu"
        className={`absolute z-20 mt-1 flex w-64 flex-col rounded-lg border border-border bg-surface p-1 shadow-card ${scope === 'review' ? 'right-0' : 'left-0'}`}
      >
        <a
          role="menuitem"
          href={`${base}?format=csv`}
          download
          className="rounded-md px-3 py-2 text-sm hover:bg-surface-2"
        >
          <span className="font-medium">Spreadsheet (CSV)</span>
          <span className="block text-xs text-muted">Excel, Google Sheets</span>
        </a>
        <a
          role="menuitem"
          href={`${base}?format=geojson`}
          download
          className="rounded-md px-3 py-2 text-sm hover:bg-surface-2"
        >
          <span className="font-medium">Map data (GeoJSON)</span>
          <span className="block text-xs text-muted">Google Earth, QGIS, other map tools</span>
        </a>
        <p className="px-3 pb-2 pt-1 text-[11px] leading-snug text-muted">
          {scope === 'review'
            ? 'Approved reports with exact locations and masked text. Sender numbers are never included. Share only with relief teams.'
            : 'Approved reports only: needs, area and an approximate (≈1 km) location. No text or personal details.'}
        </p>
      </div>
    </details>
  )
}
