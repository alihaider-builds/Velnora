"""Helpline numbers. Anyone can list the active ones (shown on the submit page and the map);
only the reviewer/organizer can see all of them, add one, rename it or turn it off."""

from fastapi import APIRouter, Depends, Request

from app.auth import require_reviewer
from app.errors import APIError
from app.schemas import Helpline, HelplineCreate, HelplineList, HelplinePatch, PublicHelplineList
from app.services import audit, helplines

router = APIRouter(prefix="/api/helplines", tags=["helplines"])
reviewer = [Depends(require_reviewer)]


@router.get("", response_model=PublicHelplineList)
def list_public(request: Request):
    with request.app.state.engine.connect() as conn:
        items = helplines.list_all(conn, include_inactive=False)
    return {"items": [{"number": h["number"], "label": h["label"]} for h in items]}


@router.get("/all", response_model=HelplineList, dependencies=reviewer)
def list_all(request: Request):
    with request.app.state.engine.connect() as conn:
        return {"items": helplines.list_all(conn)}


@router.post("", status_code=201, response_model=Helpline, dependencies=reviewer)
def create_helpline(body: HelplineCreate, request: Request):
    with request.app.state.engine.begin() as conn:
        try:
            h = helplines.create(conn, body.number, body.label, body.provider_number)
        except ValueError as exc:
            raise APIError(409, "HELPLINE_EXISTS", str(exc)) from exc
        audit.record(conn, "helplines", "helpline_created", details={"id": h["id"], "label": h["label"]})
    return h


@router.patch("/{helpline_id}", response_model=Helpline, dependencies=reviewer)
def update_helpline(helpline_id: str, body: HelplinePatch, request: Request):
    changes = body.model_dump(include=body.model_fields_set)
    with request.app.state.engine.begin() as conn:
        h = helplines.patch(conn, helpline_id, changes)
        if h is None:
            raise APIError(404, "NOT_FOUND", "Helpline not found.")
        audit.record(conn, "helplines", "helpline_updated", details={"id": helpline_id, "fields": sorted(changes)})
    return h
