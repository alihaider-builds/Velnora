"""Public, privacy-filtered endpoints. Only approved reports, never text or personal details."""

from collections import Counter
from typing import Literal

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

from app import repo
from app.schemas import PublicReportList, PublicStats
from app.services import export
from app.timeutil import now_iso

router = APIRouter(prefix="/api/public", tags=["public"])


def _public_reports(request: Request) -> list[dict]:
    settings = request.app.state.settings
    with request.app.state.engine.connect() as conn:
        out = [repo.build_public(conn, b, settings) for b in repo.load_all(conn)]
    return [p for p in out if p is not None]


@router.get("/reports", response_model=PublicReportList)
def public_reports(request: Request, need: list[str] | None = Query(None), since: str | None = None):
    items = _public_reports(request)
    if need:
        items = [p for p in items if set(need) & set(p["needs"])]
    if since:
        items = [p for p in items if p["approved_at"] >= since]
    items.sort(key=lambda p: p["approved_at"], reverse=True)
    return {"items": items, "total": len(items)}


@router.get("/stats", response_model=PublicStats)
def public_stats(request: Request):
    items = _public_reports(request)
    areas = Counter(p["area_label"] for p in items)
    return {
        "total_approved": len(items),
        "by_need": dict(Counter(n for p in items for n in p["needs"])),
        "by_area": [{"area_label": a, "count": c} for a, c in areas.most_common(10)],
    }


@router.get("/export")
def public_export(request: Request, format: Literal["csv", "geojson"] = "geojson"):
    """Open data: the same privacy-filtered points as the public map (rounded location, no text)."""
    with request.app.state.engine.connect() as conn:
        rows = export.public_rows(conn, request.app.state.settings)
    stamp = now_iso()[:10]
    if format == "csv":
        body, media = export.to_csv(rows, export.PUBLIC_COLUMNS), "text/csv; charset=utf-8"
    else:
        body, media = export.to_geojson(rows), "application/geo+json"
    return Response(body, media_type=media, headers={
        "Content-Disposition": f'attachment; filename="relieflens-public-{stamp}.{format}"'})
