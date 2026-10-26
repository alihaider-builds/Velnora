"""One path for every channel: web form, SMS, WhatsApp and the demo simulator (§16.1)."""

import secrets
import uuid
from dataclasses import dataclass

from sqlalchemy import Engine, insert, select

from app.config import Settings
from app.db import extractions, reports
from app.services import audit, privacy
from app.timeutil import now_iso

MAX_TEXT = 2000


@dataclass
class Created:
    report_id: str
    reference: str
    is_new: bool


def _reference(conn, report_id: str) -> str:
    hexid = report_id.replace("-", "").upper()
    for length in range(4, 13):
        ref = f"RL-{hexid[:length]}"
        if conn.execute(select(reports.c.id).where(reports.c.reference == ref)).first() is None:
            return ref
    return f"RL-{hexid}"


def call_reply_text(reference: str, settings: Settings) -> str:
    n = settings.helpline_emergency_number
    return (
        f"Shukriya! Aap ki call record ho gayi hai ({reference}). Ek volunteer isay sun kar review karega. "
        f"Fori khatray ki soorat mein {n} par call karein.\n"
        f"Thank you, call {reference} recorded. In a life-threatening emergency, call {n}."
    )


def reply_text(reference: str, settings: Settings) -> str:
    n = settings.helpline_emergency_number
    return (
        f"Shukriya! Aap ki report mil gayi hai ({reference}). Ek volunteer isay review karega. "
        f"Fori khatray ki soorat mein {n} par call karein.\n"
        f"Thank you, report {reference} received. In a life-threatening emergency, call {n}."
    )


def create_report(
    engine: Engine,
    settings: Settings,
    *,
    channel: str,
    text: str,
    sender: str | None = None,
    place_text: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    image_name: str | None = None,
    provider_message_id: str | None = None,
    is_synthetic: bool | None = None,
    created_at: str | None = None,
    extra_notes: list[str] | None = None,
    audio_name: str | None = None,
    call_seconds: float | None = None,
    helpline: dict | None = None,
) -> Created:
    """Store a new report (extraction pending). Idempotent on `provider_message_id`."""
    notes = list(extra_notes or [])
    text = text.strip()
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT]
        notes.append("Message was longer than 2,000 characters and was truncated.")

    with engine.begin() as conn:
        if provider_message_id:
            existing = conn.execute(
                select(reports.c.id, reports.c.reference).where(reports.c.provider_message_id == provider_message_id)
            ).first()
            if existing:
                return Created(existing.id, existing.reference, is_new=False)

        report_id = str(uuid.uuid4())
        ts = created_at or now_iso()
        sender_norm = privacy.normalize_phone(sender) if sender else None
        secret = settings.sender_hash_secret or settings.session_secret or "relieflens-dev"
        conn.execute(
            insert(reports).values(
                id=report_id,
                reference=_reference(conn, report_id),
                created_at=ts,
                updated_at=ts,
                is_synthetic=True if settings.demo_mode else bool(is_synthetic),
                channel=channel,
                sender_contact=sender_norm,
                sender_hash=privacy.sender_hash(sender_norm, secret) if sender_norm else None,
                provider_message_id=provider_message_id,
                source_text=text,
                masked_text=privacy.mask_phones(text),
                submitted_place_text=(place_text or "").strip() or None,
                submitted_lat=lat,
                submitted_lng=lng,
                image_path=image_name,
                audio_path=audio_name,
                call_duration_seconds=call_seconds,
                helpline_number=helpline["number"] if helpline else None,
                helpline_label=helpline["label"] if helpline else None,
                transcript_status="pending" if channel == "call" else None,
                intake_notes=notes,
                status="pending_review",
                urgency="unknown",
                urgency_set_by_reviewer=False,
                merged_into=None,
                reviewer_fields={},
            )
        )
        conn.execute(insert(extractions).values(report_id=report_id, status="pending", attempts=0))
        audit.record(conn, report_id, "received", actor="system", to_status="pending_review",
                     details={"channel": channel})
        reference = conn.execute(select(reports.c.reference).where(reports.c.id == report_id)).scalar_one()
    return Created(report_id, reference, is_new=True)


def new_session_secret() -> str:
    return secrets.token_urlsafe(32)
