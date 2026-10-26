import time

from fastapi import APIRouter, Request

from app.schemas import HealthResponse

router = APIRouter(prefix="/api", tags=["health"])
_CACHE_SECONDS = 30


@router.get("/health", response_model=HealthResponse)
async def health(request: Request):
    st = request.app.state
    cached = getattr(st, "model_check", None)
    if cached is None or time.monotonic() - cached[0] > _CACHE_SECONDS:
        cached = (time.monotonic(), await st.llm.is_available())
        st.model_check = cached
    return {"status": "ok", "model": st.llm.name, "model_available": cached[1], "demo_mode": st.settings.demo_mode}
