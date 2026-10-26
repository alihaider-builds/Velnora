"""Background extraction job: run the model, store the grounded result, suggest a location."""

import logging

from sqlalchemy import Engine, insert, select, update

from app.config import Settings
from app.db import extractions, locations, reports
from app.services.extraction import extract_fields
from app.services.geocoding import Geocoder, GeocoderUnavailable
from app.services.llm.base import LLMClient
from app.timeutil import now_iso

log = logging.getLogger("relieflens.jobs")


async def run_extraction(report_id: str, engine: Engine, settings: Settings, llm: LLMClient,
                         geocoder: Geocoder | None) -> None:
    with engine.begin() as conn:
        row = conn.execute(
            select(reports.c.source_text, reports.c.submitted_place_text).where(reports.c.id == report_id)
        ).first()
        if row is None:
            return
        conn.execute(update(extractions).where(extractions.c.report_id == report_id).values(status="running"))

    result = await extract_fields(row.source_text, row.submitted_place_text, llm)

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
