"""Report submission (public) and every reviewer action on reports."""

from collections import Counter
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import delete, insert, select, update

from app import repo
from app.auth import require_reviewer
from app.db import audit_log, extractions, locations, reports
from app.errors import APIError
from app.ratelimit import RateLimiter
from app.routers.deps import schedule_extraction
from app.schemas import (
    DuplicatesResponse,
    LocationRequest,
    MergeRequest,
    OriginalResponse,
    Report,
    ReportList,
    ReviewerFields,
    ReviewerStats,
    ReviewRequest,
    SubmitResponse,
    TranscriptRequest,
)
from app.services import audit, categories
from app.services.channels import create_report
from app.services.jobs import set_transcript
from app.services.storage import ImageRejected, delete_image, media_type, save_audio, save_image
from app.services.transcription import AudioRejected
from app.timeutil import now_iso, utcnow

router = APIRouter(prefix="/api", tags=["reports"])
reviewer = [Depends(require_reviewer)]
_submit_limit = RateLimiter(limit=10, window_seconds=60)

# Pakistan bounding box (generous) for submitted and confirmed points
PK_LAT = (23.5, 37.2)
PK_LNG = (60.8, 77.9)

TRANSITIONS = {
    ("pending_review", "approve"): "approved",
    ("pending_review", "reject"): "rejected",
    ("pending_review", "flag"): "flagged",
    ("flagged", "approve"): "approved",
    ("flagged", "reject"): "rejected",
    ("approved", "reopen"): "pending_review",
    ("rejected", "reopen"): "pending_review",
}
MERGEABLE_FROM = ("pending_review", "flagged")


def in_pakistan(lat: float, lng: float) -> bool:
    return PK_LAT[0] <= lat <= PK_LAT[1] and PK_LNG[0] <= lng <= PK_LNG[1]


def _report_response(request: Request, report_id: str) -> dict:
    with request.app.state.engine.connect() as conn:
        b = repo.load_one(conn, report_id)
        return repo.build_report(conn, b, request.app.state.settings, utcnow())


def _touch(conn, report_id: str, **values) -> None:
    conn.execute(update(reports).where(reports.c.id == report_id).values(updated_at=now_iso(), **values))


# ---------- public submission ----------


@router.post("/reports", status_code=201, response_model=SubmitResponse)
async def submit_report(
    request: Request,
    background: BackgroundTasks,
    text: str = Form(...),
    place_text: str | None = Form(None),
    lat: float | None = Form(None),
    lng: float | None = Form(None),
    image: UploadFile | None = File(None),
    audio: UploadFile | None = File(None),
    is_synthetic: bool | None = Form(None),
):
    """`audio` is an optional voice note (16 kHz mono WAV) the submitter recorded while dictating
    the text; it is stored privately so a reviewer can listen and check the text."""
    _submit_limit.check(request, "Too many reports from this connection. Try again in a minute.")
    settings = request.app.state.settings
    fields = []
    text = text.strip()
    if not 10 <= len(text) <= 2000:
        fields.append({"field": "text", "message": "Write between 10 and 2,000 characters."})
    if place_text and len(place_text.strip()) > 200:
        fields.append({"field": "place_text", "message": "Use 200 characters or fewer."})
    if (lat is None) != (lng is None):
        fields.append({"field": "lat", "message": "Give both latitude and longitude, or neither."})
    elif lat is not None and not in_pakistan(lat, lng):
        fields.append({"field": "lat", "message": "The pin must be inside Pakistan."})
    if fields:
        raise APIError(400, "VALIDATION_ERROR", "Some fields are missing or invalid.", {"fields": fields})

    image_name = None
    if image is not None and image.filename:
        data = await image.read(settings.max_image_bytes + 1)
        try:
            image_name = save_image(data, settings.resolve(settings.upload_dir), settings.max_image_bytes)
        except ImageRejected as exc:
            raise APIError(exc.status, exc.code, exc.message) from exc

    audio_name, audio_seconds = None, None
    if audio is not None and audio.filename:
        data = await audio.read(settings.max_audio_bytes + 1)
        upload_dir = settings.resolve(settings.upload_dir)
        try:
            audio_name, audio_seconds = save_audio(data, upload_dir, settings)
        except AudioRejected as exc:
            delete_image(upload_dir, image_name)  # don't keep a photo for a rejected report
            raise APIError(exc.status, exc.code, exc.message) from exc

    created = create_report(
        request.app.state.engine, settings, channel="web", text=text, place_text=place_text,
        lat=lat, lng=lng, image_name=image_name, is_synthetic=is_synthetic,
        audio_name=audio_name, call_seconds=audio_seconds,
    )
    schedule_extraction(request, background, created.report_id)
    return {"id": created.report_id, "reference": created.reference, "status": "pending_review"}


# ---------- reviewer: reading ----------


@router.get("/reports", response_model=ReportList, dependencies=reviewer)
def list_reports(
    request: Request,
    status: list[str] | None = Query(None),
    need: str | None = None,
    channel: list[str] | None = Query(None),
    urgency: list[str] | None = Query(None),
    extraction_status: str | None = None,
    q: str | None = Query(None, max_length=200),
    sort: Literal["newest", "oldest"] = "newest",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
):
    settings, now = request.app.state.settings, utcnow()
    with request.app.state.engine.connect() as conn:
        all_b = repo.load_all(conn)
    selected = [
        b for b in all_b
        if (not status or b.report["status"] in status)
        and (not channel or b.report["channel"] in channel)
        and (not urgency or b.report["urgency"] in urgency)
        and (not extraction_status or b.ext_status == extraction_status)
        and (not need or need in b.effective_needs())
        and (not q or repo.search_matches(b, q))
    ]
    # Time order only: the reviewer decides what matters most.
    selected.sort(key=lambda b: (b.report["created_at"], b.report["reference"]), reverse=sort == "newest")
    items = [repo.build_list_item(b, all_b, settings, now) for b in selected]

    start = (page - 1) * page_size
    return {"items": items[start:start + page_size], "total": len(items), "page": page, "page_size": page_size}


@router.get("/reports/{report_id}", response_model=Report, dependencies=reviewer)
def get_report(report_id: str, request: Request):
    return _report_response(request, report_id)


@router.get("/reports/{report_id}/original", response_model=OriginalResponse, dependencies=reviewer)
def get_original(report_id: str, request: Request):
    with request.app.state.engine.begin() as conn:
        b = repo.load_one(conn, report_id)
        audit.record(conn, report_id, "reveal_original")
    return {"source_text": b.report["source_text"], "sender": b.report["sender_contact"]}


@router.get("/reports/{report_id}/image", dependencies=reviewer)
def get_image(report_id: str, request: Request):
    settings = request.app.state.settings
    with request.app.state.engine.connect() as conn:
        b = repo.load_one(conn, report_id)
    name = b.report["image_path"]
    path = settings.resolve(settings.upload_dir) / name if name else None
    if not path or not path.is_file():
        raise APIError(404, "NOT_FOUND", "This report has no image.")
    return FileResponse(path, media_type=media_type(name), headers={"Cache-Control": "private, no-store"})


# ---------- reviewer: changing ----------


@router.post("/reports/{report_id}/retry-extraction", status_code=202, response_model=Report, dependencies=reviewer)
def retry_extraction(report_id: str, request: Request, background: BackgroundTasks):
    with request.app.state.engine.begin() as conn:
        b = repo.load_one(conn, report_id)
        if b.report["channel"] == "call" and not b.report["source_text"]:
            raise APIError(409, "TRANSCRIPT_REQUIRED", "Add a transcript first.")
        if b.ext_status in ("pending", "running"):
            raise APIError(409, "EXTRACTION_IN_PROGRESS", "The AI is already reading this report.")
        conn.execute(
            update(extractions).where(extractions.c.report_id == report_id)
            .values(status="pending", error=None, output=None, attempts=0, completed_at=None)
        )
        audit.record(conn, report_id, "retry_extraction")
    schedule_extraction(request, background, report_id)
    return _report_response(request, report_id)


@router.patch("/reports/{report_id}/fields", response_model=Report, dependencies=reviewer)
def update_fields(report_id: str, body: ReviewerFields, request: Request):
    changes = body.model_dump(include=body.model_fields_set)
    with request.app.state.engine.begin() as conn:
        b = repo.load_one(conn, report_id)
        unknown = set(changes.get("needs") or []) - categories.all_keys(conn)
        if unknown:
            raise APIError(400, "VALIDATION_ERROR", "Unknown help category.",
                           {"fields": [{"field": "needs", "message": f"Unknown: {', '.join(sorted(unknown))}"}]})
        if b.report["status"] == "merged":
            raise APIError(409, "INVALID_TRANSITION", "Merged reports can't be edited.")
        current = dict(b.corrections)
        current.update(changes)
        _touch(conn, report_id, reviewer_fields=current)
        audit.record(conn, report_id, "edit_fields", details={"fields": sorted(changes)})
    return _report_response(request, report_id)


@router.get("/reports/{report_id}/audio", dependencies=reviewer)
def get_audio(report_id: str, request: Request):
    settings = request.app.state.settings
    with request.app.state.engine.connect() as conn:
        b = repo.load_one(conn, report_id)
    name = b.report["audio_path"]
    path = settings.resolve(settings.upload_dir) / name if name else None
    if not path or not path.is_file():
        raise APIError(404, "NOT_FOUND", "This report has no recording.")
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})


@router.put("/reports/{report_id}/transcript", response_model=Report, dependencies=reviewer)
def put_transcript(report_id: str, body: TranscriptRequest, request: Request, background: BackgroundTasks):
    """Reviewer types or corrects a call transcript after listening; extraction runs again."""
    with request.app.state.engine.begin() as conn:
        b = repo.load_one(conn, report_id)
        if b.report["channel"] != "call":
            raise APIError(409, "NOT_A_CALL", "Only call reports have a transcript.")
        if b.report["status"] == "merged":
            raise APIError(409, "INVALID_TRANSITION", "Merged reports can't be edited.")
        if b.report["transcript_status"] in ("pending", "running"):
            raise APIError(409, "TRANSCRIPTION_IN_PROGRESS", "The recording is still being transcribed.")
        set_transcript(conn, report_id, body.text, "manual", "reviewer")
        audit.record(conn, report_id, "edit_transcript",
                     details={"previous_model": b.report["transcript_model"]})
    schedule_extraction(request, background, report_id)
    return _report_response(request, report_id)


@router.delete("/reports/{report_id}", status_code=204, dependencies=reviewer)
def delete_report(report_id: str, request: Request):
    settings = request.app.state.settings
    with request.app.state.engine.begin() as conn:
        b = repo.load_one(conn, report_id)
        for child in conn.execute(select(reports.c.id).where(reports.c.merged_into == report_id)).all():
            _touch(conn, child.id, merged_into=None, status="pending_review")
            audit.record(conn, child.id, "unmerged_target_deleted", from_status="merged", to_status="pending_review")
        conn.execute(delete(audit_log).where(audit_log.c.report_id == report_id))
        conn.execute(delete(locations).where(locations.c.report_id == report_id))
        conn.execute(delete(extractions).where(extractions.c.report_id == report_id))
        conn.execute(delete(reports).where(reports.c.id == report_id))
    delete_image(settings.resolve(settings.upload_dir), b.report["image_path"])
    delete_image(settings.resolve(settings.upload_dir), b.report["audio_path"])


@router.post("/reports/{report_id}/location", response_model=Report, dependencies=reviewer)
def confirm_location(report_id: str, body: LocationRequest, request: Request):
    if not in_pakistan(body.lat, body.lng):
        raise APIError(400, "VALIDATION_ERROR", "The location must be inside Pakistan.",
                       {"fields": [{"field": "lat", "message": "Outside Pakistan."}]})
    values = {"confirmed_lat": body.lat, "confirmed_lng": body.lng, "confirmed_label": body.label,
              "confirmed_source": body.source, "confirmed_at": now_iso()}
    with request.app.state.engine.begin() as conn:
        b = repo.load_one(conn, report_id)
        if b.report["status"] == "merged":
            raise APIError(409, "INVALID_TRANSITION", "Merged reports can't be changed.")
        if b.location:
            conn.execute(update(locations).where(locations.c.report_id == report_id).values(**values))
        else:
            conn.execute(insert(locations).values(report_id=report_id, **values))
        _touch(conn, report_id)
        audit.record(conn, report_id, "confirm_location", details={"source": body.source})
    return _report_response(request, report_id)


@router.get("/reports/{report_id}/duplicates", response_model=DuplicatesResponse, dependencies=reviewer)
def get_duplicates(report_id: str, request: Request):
    settings = request.app.state.settings
    with request.app.state.engine.connect() as conn:
        b = repo.load_one(conn, report_id)
        all_b = repo.load_all(conn)
    by_id = {o.id: o for o in all_b}
    candidates = []
    for other_id, score, reasons in repo.duplicates_for(b, all_b, settings):
        o = by_id[other_id]
        candidates.append({
            "report_id": other_id,
            "score": score,
            "reasons": reasons,
            "summary": {"created_at": o.report["created_at"], "needs": o.effective_needs(),
                        "place": o.effective_place(), "status": o.report["status"]},
        })
    return {"candidates": candidates}


@router.post("/reports/{report_id}/merge", response_model=Report, dependencies=reviewer)
def merge_report(report_id: str, body: MergeRequest, request: Request):
    with request.app.state.engine.begin() as conn:
        b = repo.load_one(conn, report_id)
        if body.target_id == report_id:
            raise APIError(409, "INVALID_MERGE_TARGET", "A report can't be merged into itself.")
        target = conn.execute(select(reports.c.status).where(reports.c.id == body.target_id)).first()
        if target is None or target.status in ("merged", "rejected"):
            raise APIError(409, "INVALID_MERGE_TARGET", "Choose a report that is not merged or rejected.")
        if b.report["status"] not in MERGEABLE_FROM:
            raise APIError(409, "INVALID_TRANSITION", f"Can't merge a report that is {b.report['status']}.")
        _touch(conn, report_id, status="merged", merged_into=body.target_id)
        audit.record(conn, report_id, "merge", from_status=b.report["status"], to_status="merged",
                     details={"target_id": body.target_id}, note=body.note)
        audit.record(conn, body.target_id, "merge_received", details={"source_id": report_id})
    return _report_response(request, report_id)


@router.post("/reports/{report_id}/review", response_model=Report, dependencies=reviewer)
def review_report(report_id: str, body: ReviewRequest, request: Request):
    if body.action is None and body.urgency is None:
        raise APIError(400, "VALIDATION_ERROR", "Give an action, an urgency, or both.")
    with request.app.state.engine.begin() as conn:
        b = repo.load_one(conn, report_id)
        status = b.report["status"]
        if status == "merged":
            raise APIError(409, "INVALID_TRANSITION", "Merged reports can't be reviewed.")
        new_status = status
        if body.action:
            new_status = TRANSITIONS.get((status, body.action))
            if new_status is None:
                raise APIError(409, "INVALID_TRANSITION", f"Can't {body.action} a report that is {status}.")
            if body.action == "approve" and b.confirmed_point() is None:
                raise APIError(409, "LOCATION_REQUIRED", "Confirm a location before approving.")
        if body.urgency is not None and (body.urgency != b.report["urgency"]
                                         or not b.report["urgency_set_by_reviewer"]):
            _touch(conn, report_id, urgency=body.urgency, urgency_set_by_reviewer=True)
            audit.record(conn, report_id, "set_urgency", details={"urgency": body.urgency},
                         note=None if body.action else body.note)
        if body.action:
            _touch(conn, report_id, status=new_status)
            audit.record(conn, report_id, body.action, from_status=status, to_status=new_status, note=body.note)
    return _report_response(request, report_id)


@router.get("/stats", response_model=ReviewerStats, dependencies=reviewer)
def reviewer_stats(request: Request):
    with request.app.state.engine.connect() as conn:
        all_b = repo.load_all(conn)
    return {
        "by_status": dict(Counter(b.report["status"] for b in all_b)),
        "by_need": dict(Counter(n for b in all_b for n in b.effective_needs())),
        "by_extraction_status": dict(Counter(b.ext_status for b in all_b)),
        "by_channel": dict(Counter(b.report["channel"] for b in all_b)),
        "by_urgency": dict(Counter(b.report["urgency"] for b in all_b)),
    }
