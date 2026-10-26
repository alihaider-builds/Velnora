"""Inbound SMS and WhatsApp (Twilio webhooks) plus the demo simulator (BACKEND_TECH_SPEC.md §16).

Every channel calls the same `create_report`, so the simulator behaves like real messages.
"""

import base64
import hashlib
import hmac
import logging
import uuid
from xml.sax.saxutils import escape

import httpx
from fastapi import APIRouter, BackgroundTasks, File, Form, Request, UploadFile
from fastapi.responses import Response

from app.config import Settings
from app.errors import APIError
from app.ratelimit import RateLimiter
from app.routers.deps import schedule_call, schedule_extraction
from app.schemas import SimulatorRequest, SimulatorResponse
from app.services import helplines
from app.services.channels import call_reply_text, create_report, reply_text
from app.services.storage import ImageRejected, save_image
from app.services.transcription import AudioRejected, check_audio

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


# ---------- helpline calls ----------

VOICE_GREETING = (
    "ReliefLens helpline. Yeh call record ki jayegi taake volunteer aap ki madad kar sakein. "
    "Beep ke baad batayein aap kahan hain aur aap ko kya chahiye. "
    "This call is recorded so volunteers can help. After the beep, say where you are and what you need."
)
VOICE_GOODBYE = "Shukriya. Aap ka paigham mil gaya. Thank you, your message was received."


def _store_audio(data: bytes, settings: Settings) -> tuple[str, float]:
    seconds = check_audio(data, settings)
    name = f"{uuid.uuid4().hex}.wav"
    folder = settings.resolve(settings.upload_dir)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(data)
    return name, seconds


def _twiml_xml(body: str) -> Response:
    return Response(content=f'<?xml version="1.0" encoding="UTF-8"?><Response>{body}</Response>',
                    media_type="text/xml")


@router.post("/inbound/voice", tags=["inbound"])
async def inbound_voice(request: Request):
    """Twilio calls this when the helpline rings: play the recording notice, then record."""
    settings = request.app.state.settings
    params = {k: str(v) for k, v in (await request.form()).items()}
    _verify(request, params, settings)
    if params.get("CallSid"):
        with request.app.state.engine.connect() as conn:
            helpline = helplines.match(conn, params.get("To"), params.get("ForwardedFrom"), params.get("CalledVia"))
        request.app.state.pending_calls[params["CallSid"]] = {"from": params.get("From"), "helpline": helpline}
    base = settings.public_base_url.rstrip("/")
    return _twiml_xml(
        f'<Say language="en-IN">{escape(VOICE_GREETING)}</Say>'
        f'<Record maxLength="{min(settings.max_call_seconds, 300)}" playBeep="true" trim="trim-silence" '
        f'recordingStatusCallback="{escape(base)}/api/inbound/voice/recording" '
        f'recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" '
        f'action="{escape(base)}/api/inbound/voice/done" method="POST"/>'
    )


@router.post("/inbound/voice/done", tags=["inbound"])
async def inbound_voice_done(request: Request):
    settings = request.app.state.settings
    params = {k: str(v) for k, v in (await request.form()).items()}
    _verify(request, params, settings)
    return _twiml_xml(f'<Say language="en-IN">{escape(VOICE_GOODBYE)}</Say><Hangup/>')


@router.post("/inbound/voice/recording", status_code=204, tags=["inbound"])
async def inbound_voice_recording(request: Request, background: BackgroundTasks):
    """Twilio recording-status callback: download the WAV, create a call report, transcribe."""
    settings = request.app.state.settings
    params = {k: str(v) for k, v in (await request.form()).items()}
    _verify(request, params, settings)
    if params.get("RecordingStatus", "completed") != "completed" or not params.get("RecordingUrl"):
        return Response(status_code=204)
    pending = request.app.state.pending_calls.pop(params.get("CallSid", ""), None) or {}
    sender = pending.get("from") or params.get("From")
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(params["RecordingUrl"] + ".wav",
                                    auth=(settings.twilio_account_sid, settings.twilio_auth_token))
            resp.raise_for_status()
        name, seconds = _store_audio(resp.content, settings)
    except (httpx.HTTPError, AudioRejected) as exc:
        log.warning("call recording could not be stored: %s", type(exc).__name__)
        return Response(status_code=204)
    created = create_report(
        request.app.state.engine, settings, channel="call", text="", sender=sender, audio_name=name,
        call_seconds=seconds, provider_message_id=params.get("RecordingSid") or None, helpline=pending.get("helpline"),
    )
    if created.is_new:
        schedule_call(request, background, created.report_id)
    return Response(status_code=204)


@router.post("/simulator/call", response_model=SimulatorResponse)
async def simulator_call(
    request: Request,
    background: BackgroundTasks,
    from_: str = Form(..., alias="from", min_length=5, max_length=32),
    audio: UploadFile = File(...),
    transcript_hint: str | None = Form(None, max_length=5000),
    to: str | None = Form(None, max_length=32),
):
    """Demo only: a recorded call from the browser goes through the same path as a real call.
    `transcript_hint` stands in for speech recognition when no speech model is installed."""
    settings = request.app.state.settings
    if not settings.demo_mode:
        raise APIError(404, "NOT_FOUND", "The simulator is only available in demo mode.")
    _sim_limit.check(request)
    if sum(c.isdigit() for c in from_) < 8:
        raise APIError(400, "VALIDATION_ERROR", "Use a phone-style caller number.",
                       {"fields": [{"field": "from", "message": "At least 8 digits."}]})
    data = await audio.read(settings.max_audio_bytes + 1)
    try:
        name, seconds = _store_audio(data, settings)
    except AudioRejected as exc:
        raise APIError(exc.status, exc.code, exc.message) from exc
    helpline = None
    if to:  # the helpline number dialled, matched the same way as Twilio's `To`
        with request.app.state.engine.connect() as conn:
            helpline = helplines.match(conn, to)
        if helpline is None:
            raise APIError(400, "VALIDATION_ERROR", "That number is not a registered helpline.",
                           {"fields": [{"field": "to", "message": "Not a helpline."}]})
    created = create_report(request.app.state.engine, settings, channel="call", text="", sender=from_,
                            audio_name=name, call_seconds=seconds, helpline=helpline)
    schedule_call(request, background, created.report_id, (transcript_hint or "").strip() or None)
    return {"report_id": created.report_id, "reference": created.reference,
            "reply": call_reply_text(created.reference, settings)}
