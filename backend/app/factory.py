"""FastAPI application factory (imported by app.main and by tests)."""

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import Settings
from app.db import make_engine
from app.errors import error_body, install_error_handlers
from app.routers import auth, categories, geocode, health, helplines, inbound, places, public, reports
from app.services.categories import ensure_builtins
from app.services.channels import new_session_secret
from app.services.geocoding import Geocoder
from app.services.llm import build_llm_client
from app.services.transcription import build_transcriber

log = logging.getLogger("relieflens")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(
        title="ReliefLens API",
        version="0.1.0",
        description="Multilingual disaster report intelligence. AI suggests; humans decide.",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.engine = make_engine(settings.resolve(settings.database_path))
    ensure_builtins(app.state.engine)
    app.state.llm = build_llm_client(settings)
    app.state.transcriber = build_transcriber(settings)
    app.state.pending_calls = {}  # CallSid -> {from, helpline}, until the recording arrives
    app.state.geocoder = Geocoder(settings, app.state.engine)
    app.state.session_secret = settings.session_secret or new_session_secret()
    if not settings.session_secret:
        log.warning("SESSION_SECRET is not set; using a random one (sign-ins reset on restart).")

    install_error_handlers(app)

    @app.middleware("http")
    async def limit_body_size(request: Request, call_next):
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > settings.max_request_bytes:
            return JSONResponse(error_body("REQUEST_TOO_LARGE", "The request is too large."), status_code=413)
        return await call_next(request)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    for module in (health, auth, reports, categories, helplines, public, geocode, places, inbound):
        app.include_router(module.router)
    return app

