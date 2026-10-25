"""Nominatim (OpenStreetMap) place search, Pakistan only, cached and rate-limited.

Usage policy: https://operations.osmfoundation.org/policies/nominatim/
Only the place name is ever sent, never report text or personal details.
"""

import asyncio
import time

import httpx
from sqlalchemy import Engine, insert, select

from app.config import Settings
from app.db import geocode_cache
from app.services.normalize import normalize
from app.timeutil import now_iso


class GeocoderUnavailable(Exception):
    pass


class Geocoder:
    def __init__(self, settings: Settings, engine: Engine):
        self.settings = settings
        self.engine = engine
        self._lock = asyncio.Lock()
        self._last_call = 0.0

    async def search(self, query: str, limit: int = 5) -> list[dict]:
        key = normalize(query)
        if not key:
            return []
        with self.engine.connect() as conn:
            row = conn.execute(select(geocode_cache.c.results).where(geocode_cache.c.query_norm == key)).first()
        if row is not None:
            return row.results[:limit]
        if not self.settings.geocoder_enabled:
            return []

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

        candidates = [
            {
                "lat": float(item["lat"]),
                "lng": float(item["lon"]),
                "label": item.get("display_name", ""),
                "type": item.get("addresstype") or item.get("type"),
                "importance": item.get("importance"),
            }
            for item in data
            if "lat" in item and "lon" in item
        ]
        with self.engine.begin() as conn:
            conn.execute(
                insert(geocode_cache).prefix_with("OR REPLACE"),
                {"query_norm": key, "results": candidates, "fetched_at": now_iso()},
            )
        return candidates[:limit]
