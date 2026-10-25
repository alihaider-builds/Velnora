from datetime import timedelta

from app.services.priority import compute_priority
from app.timeutil import to_iso, utcnow


def score(settings, minutes_ago=0, **kw):
    now = utcnow()
    args = dict(
        status="pending_review",
        created_at=to_iso(now - timedelta(minutes=minutes_ago)),
        reviewer_urgency="unknown",
        urgency_set_by_reviewer=False,
        extraction_status="succeeded",
        ai_urgency="high",
        needs=["medicine", "clean_water"],
        any_unmatched_evidence=False,
        now=now,
        settings=settings,
    )
    args.update(kw)
    return compute_priority(**args)


def test_demo_example_rises_with_waiting_time(settings):
    fresh = score(settings, minutes_ago=0)
    assert (fresh["score"], fresh["level"]) == (70, "high")
    waited = score(settings, minutes_ago=32)
    assert (waited["score"], waited["level"]) == (75, "critical")
    assert waited["reasons"] == ["AI suggests high urgency (+50)", "Medicine needed (+20)", "Waiting 32 min (+5)"]


def test_waiting_points_are_capped(settings):
    p = score(settings, minutes_ago=10 * 60, ai_urgency="low", needs=[])
    assert p["score"] == 10 + 25
    assert "Waiting 10 h (+25)" in p["reasons"]


def test_reviewer_urgency_replaces_ai_suggestion(settings):
    p = score(settings, urgency_set_by_reviewer=True, reviewer_urgency="low")
    assert p["urgency_source"] == "reviewer"
    assert p["score"] == 10 + 20
    assert p["reasons"][0] == "Reviewer set urgency: low (+10)"


def test_failed_extraction_gets_manual_check_bonus(settings):
    p = score(settings, extraction_status="failed", ai_urgency=None, needs=[])
    assert p["score"] == 20 + 10
    assert any("Extraction failed" in r for r in p["reasons"])


def test_unmatched_evidence_adds_points(settings):
    assert score(settings, any_unmatched_evidence=True)["score"] == 80


def test_levels(settings):
    assert score(settings, ai_urgency="medium", needs=["food"])["level"] == "medium"  # 40
    assert score(settings, ai_urgency="low", needs=[])["level"] == "low"  # 10
    assert score(settings, needs=["evacuation"], minutes_ago=200)["score"] == 100  # 50+25+25 capped


def test_closed_reports_have_no_priority(settings):
    for status in ("approved", "rejected", "merged"):
        assert score(settings, status=status) is None
    assert score(settings, status="flagged") is not None
