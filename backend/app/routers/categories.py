"""Help categories. Anyone can list active ones (labels for the map and forms); only the
reviewer/organizer can add, rename, change keywords or turn categories off."""

from fastapi import APIRouter, Depends, Request

from app.auth import current_reviewer, require_reviewer
from app.errors import APIError
from app.schemas import Category, CategoryCreate, CategoryList, CategoryPatch
from app.services import audit, categories

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=CategoryList)
def list_categories(request: Request, include_inactive: bool = False):
    if include_inactive and current_reviewer(request) is None:
        raise APIError(401, "UNAUTHORIZED", "Sign in to see turned-off categories.")
    with request.app.state.engine.connect() as conn:
        return {"items": categories.list_all(conn, include_inactive=include_inactive)}


@router.post("", status_code=201, response_model=Category, dependencies=[Depends(require_reviewer)])
def create_category(body: CategoryCreate, request: Request):
    with request.app.state.engine.begin() as conn:
        try:
            cat = categories.create(conn, body.label, body.label_ur, body.keywords)
        except ValueError as exc:
            raise APIError(409, "CATEGORY_EXISTS", str(exc)) from exc
        audit.record(conn, "categories", "category_created", details={"key": cat["key"], "label": cat["label"]})
    return cat


@router.patch("/{key}", response_model=Category, dependencies=[Depends(require_reviewer)])
def update_category(key: str, body: CategoryPatch, request: Request):
    changes = body.model_dump(include=body.model_fields_set)
    with request.app.state.engine.begin() as conn:
        try:
            cat = categories.patch(conn, key, changes)
        except ValueError as exc:
            raise APIError(409, "CATEGORY_LOCKED", str(exc)) from exc
        if cat is None:
            raise APIError(404, "NOT_FOUND", "Category not found.")
        audit.record(conn, "categories", "category_updated", details={"key": key, "fields": sorted(changes)})
    return cat
