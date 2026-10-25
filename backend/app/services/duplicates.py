"""Transparent duplicate scoring (BACKEND_TECH_SPEC.md §6.2). Suggestions only; never auto-merges."""

import math
from dataclasses import dataclass
from datetime import datetime

from rapidfuzz import fuzz

from app.config import Settings

W_TEXT, W_NEEDS, W_DIST, W_TIME = 0.40, 0.30, 0.20, 0.10
SAME_SENDER_BONUS = 0.15
EXCLUDED_STATUSES = ("rejected", "merged")
NEED_NAMES = {
    "food": "food", "clean_water": "clean water", "shelter": "shelter",
    "medicine": "medicine", "evacuation": "evacuation", "other": "other",
}


@dataclass
class DupView:
    id: str
    created_at: datetime
    status: str
    text_norm: str
    needs: list[str]
    point: tuple[float, float] | None
    place_norm: str | None
    sender_hash: str | None


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def _fmt_hours(hours: float) -> str:
    if hours < 1:
        return f"{max(1, round(hours * 60))} min apart"
    return f"{round(hours)} h apart" if hours >= 1.5 else "1 h apart"


def score_pair(a: DupView, b: DupView, settings: Settings) -> tuple[float, list[str]] | None:
    """Score how likely `b` duplicates `a`. Returns None when a gate rules the pair out:
    outside the time window, both located but too far apart, or no need in common."""
    hours = abs((a.created_at - b.created_at).total_seconds()) / 3600
    if hours > settings.dup_max_hours:
        return None
    reasons: list[str] = []

    text_sim = fuzz.token_set_ratio(a.text_norm, b.text_norm) / 100 if a.text_norm and b.text_norm else 0.0

    na, nb = set(a.needs), set(b.needs)
    if na and nb and not (na & nb):
        return None  # gate: both state needs and share none
    if a.point and b.point and haversine_km(a.point, b.point) > settings.dup_max_km:
        return None  # gate: both located and too far apart
    jaccard = len(na & nb) / len(na | nb) if (na | nb) else 0.0
    if na & nb:
        shared = ", ".join(NEED_NAMES[n] for n in sorted(na & nb))
        reasons.append(f"Same needs: {shared}" if na == nb else f"Shared needs: {shared}")

    if a.point and b.point:
        km = haversine_km(a.point, b.point)
        dist = max(0.0, 1 - km / settings.dup_max_km) if settings.dup_max_km > 0 else 0.0
        if km <= settings.dup_max_km:
            reasons.append(f"{km:.1f} km apart")
    elif a.place_norm and b.place_norm and a.place_norm == b.place_norm:
        dist = 0.5
        reasons.append("Same place name")
    else:
        dist = 0.0

    time_score = max(0.0, 1 - hours / settings.dup_max_hours) if settings.dup_max_hours > 0 else 0.0
    reasons.append(_fmt_hours(hours))

    score = W_TEXT * text_sim + W_NEEDS * jaccard + W_DIST * dist + W_TIME * time_score
    if text_sim >= 0.5:
        reasons.append(f"Similar wording (text similarity {text_sim:.2f})")
    if a.sender_hash and a.sender_hash == b.sender_hash:
        score += SAME_SENDER_BONUS
        reasons.insert(0, "Same sender")
    return min(1.0, round(score, 2)), reasons


def find_candidates(
    target: DupView, others: list[DupView], settings: Settings, limit: int = 5
) -> list[tuple[str, float, list[str]]]:
    results = []
    for other in others:
        if other.id == target.id or other.status in EXCLUDED_STATUSES:
            continue
        scored = score_pair(target, other, settings)
        if scored and scored[0] >= settings.dup_min_score:
            results.append((other.id, scored[0], scored[1]))
    results.sort(key=lambda r: -r[1])
    return results[:limit]
