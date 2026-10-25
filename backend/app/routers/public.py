"""Public, privacy-filtered endpoints. Only approved reports, never text or personal details."""

from collections import Counter

from fastapi import APIRouter, Query, Request

from app import repo
from app.schemas import PublicReportList, PublicStats

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
