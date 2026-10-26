from fastapi import APIRouter, Depends, Request, Response

from app.auth import REVIEWER, clear_session, current_reviewer, require_reviewer, set_session, verify_password
from app.errors import APIError
from app.ratelimit import RateLimiter, client_key
from app.schemas import LoginRequest, ReviewerResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])
_failures = RateLimiter(limit=5, window_seconds=60)


@router.post("/login", response_model=ReviewerResponse)
def login(body: LoginRequest, request: Request, response: Response):
    settings = request.app.state.settings
    key = client_key(request)
    if settings.rate_limit_enabled and _failures.blocked(key):
        raise APIError(429, "RATE_LIMITED", "Too many attempts. Wait a minute and try again.")
    if not settings.reviewer_password_hash:
        raise APIError(503, "REVIEWER_NOT_CONFIGURED",
                       "No reviewer password is set. Set REVIEWER_PASSWORD_HASH (see the README).")
    if not verify_password(body.password, settings.reviewer_password_hash):
        _failures.hit(key)
        raise APIError(401, "INVALID_CREDENTIALS", "Incorrect password.")
    set_session(request, response)
    return {"reviewer": REVIEWER}


@router.post("/logout", status_code=204, dependencies=[Depends(require_reviewer)])
def logout():
    response = Response(status_code=204)
    clear_session(response)
    return response


@router.get("/me", response_model=ReviewerResponse)
def me(request: Request):
    reviewer = current_reviewer(request)
    if reviewer is None:
        raise APIError(401, "UNAUTHORIZED", "Not signed in.")
    return {"reviewer": reviewer}
