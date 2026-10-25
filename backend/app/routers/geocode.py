from fastapi import APIRouter, Depends, Query, Request

from app.auth import require_reviewer
from app.errors import APIError
from app.schemas import GeocodeResponse
from app.services.geocoding import GeocoderUnavailable

router = APIRouter(prefix="/api", tags=["geocode"], dependencies=[Depends(require_reviewer)])


@router.get("/geocode", response_model=GeocodeResponse)
async def geocode(request: Request, q: str = Query(..., min_length=2, max_length=200)):
    try:
        candidates = await request.app.state.geocoder.search(q, limit=5)
    except GeocoderUnavailable as exc:
        raise APIError(502, "GEOCODER_UNAVAILABLE", "Map search is unavailable. Drop a pin instead.") from exc
    return {"candidates": candidates}
