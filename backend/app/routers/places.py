"""Type-ahead place suggestions for the public "Where?" field. Only the typed place name is
sent to the map provider."""

from fastapi import APIRouter, Query, Request

from app.errors import APIError
from app.ratelimit import RateLimiter
from app.schemas import PlaceSuggestResponse
from app.services.geocoding import GeocoderUnavailable

router = APIRouter(prefix="/api/places", tags=["geocode"])
_limit = RateLimiter(limit=60, window_seconds=60)


@router.get("/suggest", response_model=PlaceSuggestResponse)
async def suggest(request: Request, q: str = Query(..., min_length=3, max_length=120)):
    _limit.check(request)
    geocoder = request.app.state.geocoder
    try:
        items = await geocoder.suggest(q.strip())
    except GeocoderUnavailable as exc:
        raise APIError(502, "GEOCODER_UNAVAILABLE", "Suggestions are unavailable. Type the place.") from exc
    return {"provider": geocoder.provider, "items": items}
