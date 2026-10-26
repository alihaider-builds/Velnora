"""Loading reports and building the API response shapes (BACKEND_TECH_SPEC.md §4.3)."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection, func, select

from app.config import Settings
from app.db import audit_log, extractions, locations, reports
from app.errors import APIError
from app.services import privacy
from app.services.duplicates import DupView, find_candidates
from app.services.normalize import normalize, normalize_for_compare
from app.timeutil import parse_iso

PREVIEW_CHARS = 80


@dataclass
class Bundle:
    report: dict
    extraction: dict | None
    location: dict | None

    @property
    def id(self) -> str:
        return self.report["id"]

    @property
    def ext_status(self) -> str:
        return self.extraction["status"] if self.extraction else "pending"

    @property
    def ai(self) -> dict | None:
        """Grounded AI output, only when extraction succeeded."""
        if self.extraction and self.extraction["status"] == "succeeded":
            return self.extraction["output"]
        return None

    @property
    def corrections(self) -> dict:
        return self.report["reviewer_fields"] or {}

    def effective_needs(self) -> list[str]:
        if self.corrections.get("needs") is not None:
            return list(self.corrections["needs"])
        return [n["category"] for n in self.ai["needs"]] if self.ai else []

    def effective_place(self) -> str | None:
        if self.corrections.get("place_name"):
            return self.corrections["place_name"]
        if self.ai and self.ai.get("place_name"):
            return self.ai["place_name"]["text"]
        return self.report["submitted_place_text"]

    def confirmed_point(self) -> tuple[float, float] | None:
        loc = self.location
        if loc and loc["confirmed_lat"] is not None:
            return loc["confirmed_lat"], loc["confirmed_lng"]
        return None

    def best_point(self) -> tuple[float, float] | None:
        if p := self.confirmed_point():
            return p
        loc = self.location
        if loc and loc["suggested_lat"] is not None:
            return loc["suggested_lat"], loc["suggested_lng"]
        r = self.report
        if r["submitted_lat"] is not None:
            return r["submitted_lat"], r["submitted_lng"]
        return None

    def any_unmatched(self) -> bool:
        ai = self.ai
        if not ai:
            return False
        fields = [n["evidence"] for n in ai["needs"]] + [q["evidence"] for q in ai["quantities"]]
        fields += [ai[k]["evidence"] for k in ("place_name", "time_reference") if ai.get(k)]
        return any(not e["matched"] for e in fields)

    def dup_view(self) -> DupView:
        place = self.effective_place()
        return DupView(
            id=self.id,
            created_at=parse_iso(self.report["created_at"]),
            status=self.report["status"],
            text_norm=normalize_for_compare(self.report["source_text"]),
            needs=self.effective_needs(),
            point=self.best_point(),
            place_norm=normalize_for_compare(place) if place else None,
            sender_hash=self.report["sender_hash"],
        )


# ---------- loading ----------


def _bundle(row, ext_by_id: dict, loc_by_id: dict) -> Bundle:
    r = dict(row._mapping)
    return Bundle(report=r, extraction=ext_by_id.get(r["id"]), location=loc_by_id.get(r["id"]))


def load_all(conn: Connection) -> list[Bundle]:
    ext_by_id = {e.report_id: dict(e._mapping) for e in conn.execute(select(extractions))}
    loc_by_id = {loc.report_id: dict(loc._mapping) for loc in conn.execute(select(locations))}
    return [_bundle(row, ext_by_id, loc_by_id) for row in conn.execute(select(reports))]


def load_one(conn: Connection, report_id: str) -> Bundle:
    row = conn.execute(select(reports).where(reports.c.id == report_id)).first()
    if row is None:
        raise APIError(404, "NOT_FOUND", "Report not found.")
    ext = conn.execute(select(extractions).where(extractions.c.report_id == report_id)).first()
    loc = conn.execute(select(locations).where(locations.c.report_id == report_id)).first()
    return Bundle(
        report=dict(row._mapping),
        extraction=dict(ext._mapping) if ext else None,
        location=dict(loc._mapping) if loc else None,
    )


# ---------- derived values ----------


def call_obj(b: Bundle) -> dict | None:
    r = b.report
    if r["channel"] != "call":
        return None
    return {
        "helpline": {"number": r["helpline_number"], "label": r["helpline_label"]} if r["helpline_number"] else None,
        "duration_seconds": r["call_duration_seconds"],
        "has_audio": bool(r["audio_path"]),
        "audio_url": f"/api/reports/{r['id']}/audio" if r["audio_path"] else None,
        "transcript_status": r["transcript_status"] or "pending",
        "transcript_model": r["transcript_model"],
        "transcript_error": r["transcript_error"],
    }


def voice_note_obj(b: Bundle) -> dict | None:
    """Web reports can carry the submitter's voice recording (calls use `call_obj`)."""
    r = b.report
    if r["channel"] == "call" or not r["audio_path"]:
        return None
    return {"audio_url": f"/api/reports/{r['id']}/audio", "duration_seconds": r["call_duration_seconds"]}


def duplicates_for(b: Bundle, all_bundles: list[Bundle], settings: Settings) -> list[tuple[str, float, list[str]]]:
    if b.report["status"] in ("rejected", "merged"):
        return []
    return find_candidates(b.dup_view(), [o.dup_view() for o in all_bundles], settings)


def same_sender_count(b: Bundle, all_bundles: list[Bundle], settings: Settings) -> int:
    h = b.report["sender_hash"]
    if not h:
        return 0
    me = parse_iso(b.report["created_at"])
    return sum(
        1
        for o in all_bundles
        if o.id != b.id
        and o.report["sender_hash"] == h
        and abs((parse_iso(o.report["created_at"]) - me).total_seconds()) <= 24 * 3600
    )


# ---------- response builders ----------


def extraction_obj(b: Bundle, intake_notes: list[str]) -> dict:
    e = b.extraction or {"status": "pending", "model": None, "attempts": 0, "completed_at": None, "error": None}
    ai = b.ai
    return {
        "status": e["status"],
        "model": e.get("model"),
        "attempts": e.get("attempts") or 0,
        "completed_at": e.get("completed_at"),
        "error": e.get("error"),
        "language": ai["language"] if ai else None,
        "needs": ai["needs"] if ai else [],
        "quantities": ai["quantities"] if ai else [],
        "place_name": ai["place_name"] if ai else None,
        "time_reference": ai["time_reference"] if ai else None,
        "uncertainties": (list(intake_notes) + ai["uncertainties"]) if ai else list(intake_notes),
    }


def location_obj(b: Bundle) -> dict:
    r, loc = b.report, b.location or {}
    submitted_point = (
        {"lat": r["submitted_lat"], "lng": r["submitted_lng"]} if r["submitted_lat"] is not None else None
    )
    suggested = None
    if loc.get("suggested_lat") is not None:
        suggested = {"lat": loc["suggested_lat"], "lng": loc["suggested_lng"], "label": loc.get("suggested_label"),
                     "source": "geocoder_candidate"}
    elif submitted_point:
        suggested = {**submitted_point, "label": r["submitted_place_text"], "source": "submitter_pin"}
    confirmed = None
    if loc.get("confirmed_lat") is not None:
        confirmed = {"lat": loc["confirmed_lat"], "lng": loc["confirmed_lng"], "label": loc.get("confirmed_label"),
                     "source": loc["confirmed_source"], "confirmed_at": loc["confirmed_at"]}
    return {"submitted_text": r["submitted_place_text"], "submitted_point": submitted_point,
            "suggested": suggested, "confirmed": confirmed}


def reviewer_fields_obj(b: Bundle) -> dict:
    c = b.corrections
    return {k: c.get(k) for k in ("needs", "quantities", "place_name", "time_reference")}


def audit_entries(conn: Connection, report_id: str) -> list[dict]:
    rows = conn.execute(select(audit_log).where(audit_log.c.report_id == report_id).order_by(audit_log.c.id))
    return [
        {"at": a.at, "actor": a.actor, "action": a.action, "from_status": a.from_status,
         "to_status": a.to_status, "note": a.note}
        for a in rows
    ]


def build_report(conn: Connection, b: Bundle, settings: Settings, now: datetime) -> dict:
    all_b = load_all(conn)
    r = b.report
    sender = None
    if r["sender_contact"]:
        sender = {"masked": privacy.mask_sender(r["sender_contact"]),
                  "same_sender_count": same_sender_count(b, all_b, settings)}
    return {
        "id": r["id"],
        "reference": r["reference"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
        "is_synthetic": bool(r["is_synthetic"]),
        "channel": r["channel"],
        "sender": sender,
        "call": call_obj(b),
        "voice_note": voice_note_obj(b),
        "source_text": r["source_text"],
        "masked_text": r["masked_text"],
        "has_image": bool(r["image_path"]),
        "image_url": f"/api/reports/{r['id']}/image" if r["image_path"] else None,
        "extraction": extraction_obj(b, r["intake_notes"] or []),
        "reviewer_fields": reviewer_fields_obj(b),
        "location": location_obj(b),
        "status": r["status"],
        "urgency": r["urgency"],
        "merged_into": r["merged_into"],
        "duplicate_count": len(duplicates_for(b, all_b, settings)),
        "audit": audit_entries(conn, r["id"]),
    }


def build_list_item(b: Bundle, all_b: list[Bundle], settings: Settings, now: datetime) -> dict:
    r = b.report
    return {
        "id": r["id"],
        "reference": r["reference"],
        "created_at": r["created_at"],
        "is_synthetic": bool(r["is_synthetic"]),
        "channel": r["channel"],
        "preview": r["masked_text"][:PREVIEW_CHARS],
        "language": b.ai["language"] if b.ai else None,
        "needs": b.effective_needs(),
        "place": b.effective_place(),
        "extraction_status": b.ext_status,
        "transcript_status": r["transcript_status"],
        "has_voice_note": voice_note_obj(b) is not None,
        "status": r["status"],
        "urgency": r["urgency"],
        "duplicate_count": len(duplicates_for(b, all_b, settings)),
        "has_confirmed_location": b.confirmed_point() is not None,
    }


def approved_at(conn: Connection, report_id: str) -> str | None:
    return conn.execute(
        select(func.max(audit_log.c.at)).where(
            audit_log.c.report_id == report_id, audit_log.c.to_status == "approved"
        )
    ).scalar()


def build_public(conn: Connection, b: Bundle, settings: Settings) -> dict | None:
    """The only shape the public ever sees: no text, numbers, images or exact coordinates."""
    point = b.confirmed_point()
    if b.report["status"] != "approved" or point is None:
        return None
    d = settings.public_coord_decimals
    return {
        "id": b.id,
        "needs": b.effective_needs(),
        "area_label": privacy.area_label((b.location or {}).get("confirmed_label")),
        "lat": privacy.round_coord(point[0], d),
        "lng": privacy.round_coord(point[1], d),
        "approved_at": approved_at(conn, b.id) or b.report["updated_at"],
        "is_synthetic": bool(b.report["is_synthetic"]),
    }


def search_matches(b: Bundle, q: str) -> bool:
    return normalize(q) in normalize(b.report["masked_text"])
