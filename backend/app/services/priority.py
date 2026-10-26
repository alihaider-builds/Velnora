"""Priority score for the review queue (BACKEND_TECH_SPEC.md §17).

A suggestion for the reviewer's order of work, never an automatic decision.
"""

from datetime import datetime

from app.config import Settings
from app.timeutil import parse_iso, to_iso

URGENCY_POINTS = {"high": 50, "medium": 30, "low": 10, "unknown": 20}
NEED_POINTS = {"evacuation": 25, "medicine": 20, "clean_water": 15, "food": 10, "shelter": 10, "other": 0}
NEED_LABELS = {
    "evacuation": "Evacuation needed",
    "medicine": "Medicine needed",
    "clean_water": "Clean water needed",
    "food": "Food needed",
    "shelter": "Shelter needed",
}
NEEDS_HUMAN_POINTS = 10
LEVELS = ((75, "critical"), (55, "high"), (35, "medium"), (0, "low"))
OPEN_STATUSES = ("pending_review", "flagged")


def _level(score: int) -> str:
    return next(name for floor, name in LEVELS if score >= floor)


def _fmt_wait(minutes: int) -> str:
    if minutes < 60:
        return f"{minutes} min"
    h, m = divmod(minutes, 60)
    return f"{h} h {m} min" if m else f"{h} h"


def compute_priority(
    *,
    status: str,
    created_at: str,
    reviewer_urgency: str,
    urgency_set_by_reviewer: bool,
    extraction_status: str,
    ai_urgency: str | None,
    needs: list[str],
    any_unmatched_evidence: bool,
    now: datetime,
    settings: Settings,
) -> dict | None:
    if status not in OPEN_STATUSES:
        return None
    reasons: list[str] = []

    if urgency_set_by_reviewer:
        urgency, source = reviewer_urgency, "reviewer"
        u_points = URGENCY_POINTS[urgency]
        reasons.append(f"Reviewer set urgency: {urgency} (+{u_points})")
    else:
        source = "ai_suggestion"
        if extraction_status == "succeeded" and ai_urgency:
            u_points = URGENCY_POINTS[ai_urgency]
            label = f"AI suggests {ai_urgency} urgency" if ai_urgency != "unknown" else "AI urgency unclear"
            reasons.append(f"{label} (+{u_points})")
        else:
            u_points = URGENCY_POINTS["unknown"]
            reasons.append(f"Urgency not yet known (+{u_points})")

    need_points = max((NEED_POINTS.get(n, 0) for n in needs), default=0)
    if need_points:
        top = max(needs, key=lambda n: NEED_POINTS.get(n, 0))
        reasons.append(f"{NEED_LABELS[top]} (+{need_points})")

    waited = max(0, int((now - parse_iso(created_at)).total_seconds() // 60))
    steps = waited // max(1, settings.priority_wait_step_minutes)
    wait_points = min(steps * settings.priority_wait_points_per_step, settings.priority_wait_max_points)
    if wait_points:
        reasons.append(f"Waiting {_fmt_wait(waited)} (+{wait_points})")

    human_points = 0
    if extraction_status == "failed":
        human_points = NEEDS_HUMAN_POINTS
        reasons.append(f"Extraction failed — needs manual check (+{human_points})")
    elif any_unmatched_evidence:
        human_points = NEEDS_HUMAN_POINTS
        reasons.append(f"Some AI evidence not found — needs a check (+{human_points})")

    score = min(100, u_points + need_points + wait_points + human_points)
    return {
        "score": score,
        "level": _level(score),
        "reasons": reasons,
        "urgency_source": source,
        "computed_at": to_iso(now),
    }
