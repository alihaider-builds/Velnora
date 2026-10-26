"""Inbound SMS and WhatsApp (Twilio webhooks) plus the demo simulator (BACKEND_TECH_SPEC.md §16).

Every channel calls the same `create_report`, so the simulator behaves like real messages.
"""

import base64
import hashlib
import hmac
import logging
from xml.sax.saxutils import escape

import httpx
from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import Response

from app.config import Settings
from app.errors import APIError
from app.ratelimit import RateLimiter
from app.routers.deps import schedule_extraction
from app.schemas import SimulatorRequest, SimulatorResponse
from app.services.channels import create_report, reply_text
from app.services.storage import ImageRejected, save_image

log = logging.getLogger("relieflens.inbound")
router = APIRouter(prefix="/api", tags=["inbound"])
_sim_limit = RateLimiter(limit=20, window_seconds=60)


def twilio_signature(auth_token: str, url: str, params: dict[str, str]) -> str:
    """Twilio's documented scheme: HMAC-SHA1 over the URL plus sorted key+value pairs, base64."""
    data = url + "".join(k + params[k] for k in sorted(params))
    digest = hmac.new(auth_token.encode(), data.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def _verify(request: Request, params: dict[str, str], settings: Settings) -> None:
    if not settings.twilio_validate_signature:
        return
    if not settings.twilio_auth_token or not settings.public_base_url:
        raise APIError(503, "CHANNEL_NOT_CONFIGURED", "Set TWILIO_AUTH_TOKEN and PUBLIC_BASE_URL first.")
    url = settings.public_base_url.rstrip("/") + request.url.path
    expected = twilio_signature(settings.twilio_auth_token, url, params)
    given = request.headers.get("X-Twilio-Signature", "")
    if not hmac.compare_digest(expected, given):
        raise APIError(403, "INVALID_SIGNATURE", "Request signature is not valid.")


def _twiml(message: str) -> Response:
    xml = f'<?xml version="1.0" encoding="UTF-8"?><Response><Message>{escape(message)}</Message></Response>'
    return Response(content=xml, media_type="text/xml")


async def _download_media(params: dict[str, str], settings: Settings) -> tuple[str | None, list[str]]:
    """Fetch the first WhatsApp image (P1). Returns (stored name, notes)."""
    try:
        if int(params.get("NumMedia", "0") or 0) < 1:
            return None, []
    except ValueError:
        return None, []
    url, ctype = params.get("MediaUrl0", ""), params.get("MediaContentType0", "")
    if not url or not ctype.startswith("image/"):
        return None, ["Attachment was not an image and was ignored."]
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, auth=(settings.twilio_account_sid, settings.twilio_auth_token))
            resp.raise_for_status()
        name = save_image(resp.content, settings.resolve(settings.upload_dir), settings.max_image_bytes)
        return name, []
    except (httpx.HTTPError, ImageRejected) as exc:
        log.warning("media download failed: %s", type(exc).__name__)
        return None, ["Attached image could not be used."]


async def _handle_twilio(request: Request, background: BackgroundTasks, channel: str) -> Response:
    settings = request.app.state.settings
    form = await request.form()
    params = {k: str(v) for k, v in form.items()}
    _verify(request, params, settings)

    body = params.get("Body", "").strip()
    sender = params.get("From", "")
    if not body or not sender:
        return _twiml("Please send your report as a text message.")

    image_name, notes = (None, [])
    if channel == "whatsapp":
        image_name, notes = await _download_media(params, settings)

    created = create_report(
        request.app.state.engine, settings, channel=channel, text=body, sender=sender,
        image_name=image_name, provider_message_id=params.get("MessageSid") or None, extra_notes=notes,
    )
    if created.is_new:
        schedule_extraction(request, background, created.report_id)
    return _twiml(reply_text(created.reference, settings))


@router.post("/inbound/sms", tags=["inbound"])
async def inbound_sms(request: Request, background: BackgroundTasks):
    return await _handle_twilio(request, background, "sms")


@router.post("/inbound/whatsapp", tags=["inbound"])
async def inbound_whatsapp(request: Request, background: BackgroundTasks):
    return await _handle_twilio(request, background, "whatsapp")


@router.post("/simulator/send", response_model=SimulatorResponse)
def simulator_send(body: SimulatorRequest, request: Request, background: BackgroundTasks):
    settings = request.app.state.settings
    if not settings.demo_mode:
        raise APIError(404, "NOT_FOUND", "The simulator is only available in demo mode.")
    _sim_limit.check(request)
    digits = sum(c.isdigit() for c in body.from_)
    if digits < 8:
        raise APIError(400, "VALIDATION_ERROR", "Use a phone-style sender number.",
                       {"fields": [{"field": "from", "message": "At least 8 digits."}]})
    created = create_report(request.app.state.engine, settings, channel=body.channel, text=body.body,
                            sender=body.from_)
    schedule_extraction(request, background, created.report_id)
    return {"report_id": created.report_id, "reference": created.reference,
            "reply": reply_text(created.reference, settings)}
