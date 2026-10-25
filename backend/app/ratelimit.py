"""Small in-memory sliding-window rate limiter (single process is enough for the MVP)."""

import time
from collections import defaultdict, deque

from fastapi import Request

from app.errors import APIError


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str) -> deque[float]:
        hits = self._hits[key]
        cutoff = time.monotonic() - self.window
        while hits and hits[0] < cutoff:
            hits.popleft()
        return hits

    def blocked(self, key: str) -> bool:
        return len(self._prune(key)) >= self.limit

    def hit(self, key: str) -> None:
        self._prune(key).append(time.monotonic())

    def check(self, request: Request, message: str = "Too many requests. Try again in a minute.") -> None:
        if not request.app.state.settings.rate_limit_enabled:
            return
        key = client_key(request)
        if self.blocked(key):
            raise APIError(429, "RATE_LIMITED", message)
        self.hit(key)


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"
