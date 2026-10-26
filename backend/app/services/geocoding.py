"""Place search, Pakistan only, cached. Suggestions only — a reviewer confirms every location.

- Google Geocoding API when GOOGLE_MAPS_API_KEY is set (better coverage of neighbourhoods and
  landmarks). Google's terms expect its results to be shown on a Google map; the frontend
  switches to Google Maps when it has a key too.
- OpenStreetMap Nominatim otherwise, within its usage policy:
  https://operations.osmfoundation.org/policies/nominatim/

If the full phrase finds nothing, broader versions are tried, e.g.
"Lalkurti, Cantt, Rawalpindi" -> "Lalkurti, Cantonment, Rawalpindi" -> "Cantt, Rawalpindi" -> "Rawalpindi".
Only the place name is ever sent, never report text or personal details.
"""

import asyncio
import re
import time

import httpx
from sqlalchemy import Engine, insert, select

from app.config import Settings
from app.db import geocode_cache
from app.services.normalize import normalize
from app.timeutil import now_iso

GOOGLE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
MAX_VARIANTS = 4


class GeocoderUnavailable(Exception):
    pass


def query_variants(query: str) -> list[str]:
    q = " ".join(query.split())
    parts = [p.strip() for p in q.split(",") if p.strip()]
    if len(parts) == 1:
        parts = q.split()
    variants = [q]
    expanded = re.sub(r"\bcantt\b\.?", "Cantonment", q, flags=re.IGNORECASE)
    if expanded != q:
        variants.append(expanded)
    for i in range(1, len(parts)):
        variants.append(", ".join(parts[i:]) if "," in q else " ".join(parts[i:]))
    seen, out = set(), []
    for v in variants:
        key = normalize(v)
        if key and key not in seen:
            seen.add(key)
            out.append(v)
    return out[:MAX_VARIANTS]


class Geocoder:
    def __init__(self, settings: Settings, engine: Engine):
        self.settings = settings
        self.engine = engine
        self._lock = asyncio.Lock()
        self._last_call = 0.0

    @property
    def provider(self) -> str:
        return "google" if self.settings.google_maps_api_key else "osm"

    async def search(self, query: str, limit: int = 5) -> list[dict]:
        for variant in query_variants(query):
            found = await self._search_one(variant, limit)
            if found:
                return found
        return []

    async def _search_one(self, query: str, limit: int) -> list[dict]:
        key = f"{self.provider}:{normalize(query)}"
        with self.engine.connect() as conn:
            row = conn.execute(select(geocode_cache.c.results).where(geocode_cache.c.query_norm == key)).first()
        if row is not None:
            return row.results[:limit]
        if not self.settings.geocoder_enabled:
            return []
        candidates = await (self._google(query) if self.provider == "google" else self._nominatim(query, limit))
        with self.engine.begin() as conn:
            conn.execute(
                insert(geocode_cache).prefix_with("OR REPLACE"),
                {"query_norm": key, "results": candidates, "fetched_at": now_iso()},
            )
        return candidates[:limit]

    async def _nominatim(self, query: str, limit: int) -> list[dict]:
        async with self._lock:  # at most one request per second
            wait = 1.0 - (time.monotonic() - self._last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.get(
                        f"{self.settings.nominatim_url.rstrip('/')}/search",
                        params={"q": query, "format": "jsonv2", "countrycodes": "pk", "limit": limit,
                                "accept-language": "en"},
                        headers={"User-Agent": self.settings.nominatim_user_agent},
                    )
                    resp.raise_for_status()
                    data = resp.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise GeocoderUnavailable(str(exc)) from exc
            finally:
                self._last_call = time.monotonic()
        return [
            {"lat": float(item["lat"]), "lng": float(item["lon"]), "label": item.get("display_name", ""),
             "type": item.get("addresstype") or item.get("type"), "importance": item.get("importance")}
            for item in data
            if "lat" in item and "lon" in item
        ]

    async def _google(self, query: str) -> list[dict]:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(GOOGLE_URL, params={
                    "address": query, "key": self.settings.google_maps_api_key, "region": "pk",
                    "components": "country:PK", "language": "en",
                })
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise GeocoderUnavailable(str(exc)) from exc
        status = data.get("status")
        if status == "ZERO_RESULTS":
            return []
        if status != "OK":
            raise GeocoderUnavailable(f"Google geocoding status {status}")
        return [
            {"lat": r["geometry"]["location"]["lat"], "lng": r["geometry"]["location"]["lng"],
             "label": r.get("formatted_address", ""), "type": (r.get("types") or [None])[0], "importance": None}
            for r in data.get("results", [])
        ]
