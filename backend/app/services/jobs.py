"""Background jobs: call transcription, AI extraction, location suggestion."""

import logging
from pathlib import Path

from sqlalchemy import Engine, insert, select, update

from app.config import Settings
from app.db import extractions, locations, reports
from app.services import audit, categories, privacy
from app.services.extraction import extract_fields
from app.services.geocoding import Geocoder, GeocoderUnavailable
from app.services.llm.base import LLMClient
from app.services.transcription import Transcriber, TranscriberUnavailable
from app.timeutil import now_iso

log = logging.getLogger("relieflens.jobs")
DEMO_TRANSCRIPT_MODEL = "typed-demo-transcript"


async def run_extraction(report_id: str, engine: Engine, settings: Settings, llm: LLMClient,
                         geocoder: Geocoder | None) -> None:
    with engine.begin() as conn:
        row = conn.execute(
            select(reports.c.source_text, reports.c.submitted_place_text).where(reports.c.id == report_id)
        ).first()
        if row is None:
            return
        cats = categories.active(conn)
        conn.execute(update(extractions).where(extractions.c.report_id == report_id).values(status="running"))

    result = await extract_fields(row.source_text, row.submitted_place_text, llm, cats)

    with engine.begin() as conn:
        if conn.execute(select(reports.c.id).where(reports.c.id == report_id)).first() is None:
            return  # deleted while the model was running
        conn.execute(
            update(extractions)
            .where(extractions.c.report_id == report_id)
            .values(
                status=result.status,
                model=llm.name,
                attempts=result.attempts,
                language=result.language,
                output=result.output,
                raw_response=result.raw_response,
                error=result.error,
                completed_at=now_iso(),
            )
        )
    log.info("extraction %s for report %s (attempts=%s)", result.status, report_id, result.attempts)

    if result.status == "succeeded" and geocoder is not None:
        place = (result.output or {}).get("place_name") or {}
        query = place.get("text") or row.submitted_place_text
        if query:
            await suggest_location(report_id, query, engine, geocoder)


async def suggest_location(report_id: str, query: str, engine: Engine, geocoder: Geocoder) -> None:
    try:
        candidates = await geocoder.search(query, limit=1)
    except GeocoderUnavailable:
        log.warning("geocoder unavailable for report %s", report_id)
        return
    if not candidates:
        return
    top = candidates[0]
    values = {"suggested_lat": top["lat"], "suggested_lng": top["lng"], "suggested_label": top["label"]}
    with engine.begin() as conn:
        exists = conn.execute(select(locations.c.report_id).where(locations.c.report_id == report_id)).first()
        if exists:
            conn.execute(update(locations).where(locations.c.report_id == report_id).values(**values))
        else:
            conn.execute(insert(locations).values(report_id=report_id, **values))


def set_transcript(conn, report_id: str, text: str, status: str, model: str | None) -> None:
    text = text.strip()[:5000]
    conn.execute(update(reports).where(reports.c.id == report_id).values(
        source_text=text, masked_text=privacy.mask_phones(text), transcript_status=status,
        transcript_model=model, transcript_error=None, updated_at=now_iso()))
    conn.execute(update(extractions).where(extractions.c.report_id == report_id).values(
        status="pending", error=None, output=None, attempts=0, completed_at=None))


async def run_call(report_id: str, engine: Engine, settings: Settings, llm: LLMClient,
                   geocoder: Geocoder | None, transcriber: Transcriber, demo_transcript: str | None = None) -> None:
    """Transcribe a call recording, then extract. Without a speech model the reviewer types the
    transcript (or, in demo mode, a typed stand-in sent with the simulated call is used)."""
    with engine.begin() as conn:
        row = conn.execute(select(reports.c.audio_path).where(reports.c.id == report_id)).first()
        if row is None or not row.audio_path:
            return
        conn.execute(update(reports).where(reports.c.id == report_id).values(transcript_status="running"))

    text, model, error = None, None, None
    if transcriber.available():
        try:
            audio = (settings.resolve(settings.upload_dir) / row.audio_path).read_bytes()
            text, model = await transcriber.transcribe(audio), transcriber.name
            if not text:
                error = "No speech was recognised in the recording."
        except (TranscriberUnavailable, OSError) as exc:
            error = str(exc)
        except Exception as exc:  # model errors must never crash the queue
            log.exception("transcription failed for %s", report_id)
            error = f"Transcription failed ({type(exc).__name__})."
    else:
        error = "No speech model is configured. Listen to the recording and type the transcript."
    if not text and demo_transcript and settings.demo_mode:
        text, model, error = demo_transcript, DEMO_TRANSCRIPT_MODEL, None

    with engine.begin() as conn:
        if conn.execute(select(reports.c.id).where(reports.c.id == report_id)).first() is None:
            return
        if text:
            set_transcript(conn, report_id, text, "succeeded", model)
            audit.record(conn, report_id, "transcribed", actor="system", details={"model": model})
        else:
            conn.execute(update(reports).where(reports.c.id == report_id).values(
                transcript_status="failed", transcript_error=error, updated_at=now_iso()))
            conn.execute(update(extractions).where(extractions.c.report_id == report_id).values(
                status="failed", error="Waiting for a transcript.", completed_at=now_iso()))
    if text:
        await run_extraction(report_id, engine, settings, llm, geocoder)


def audio_path(settings: Settings, name: str) -> Path:
    return settings.resolve(settings.upload_dir) / name
