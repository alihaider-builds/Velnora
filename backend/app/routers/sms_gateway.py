"""Webhook for SMS forwarded by the Android SMS gateway on the helpline phone."""

import json
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import func, select

from app.auth import require_reviewer
from app.db import reports
from app.errors import APIError
from app.routers.deps import schedule_extraction
from app.schemas import SmsGatewayRegister, SmsGatewayRegistered, SmsGatewayStatus
from app.services import audit, helplines, sms_gateway
from app.services.channels import create_report, reply_text
from app.timeutil import to_iso, utcnow

router = APIRouter(prefix="/api", tags=["inbound"])
reviewer = [Depends(require_reviewer)]


@router.get("/sms-gateway/status", response_model=SmsGatewayStatus, dependencies=reviewer)
def gateway_status(request: Request):
    settings = request.app.state.settings
    since = to_iso(utcnow() - timedelta(hours=24))
    gw = reports.c.provider_message_id.like("smsgate:%")
    with request.app.state.engine.connect() as conn:
        last = conn.execute(select(func.max(reports.c.created_at)).where(gw)).scalar()
        recent = conn.execute(select(func.count()).where(gw, reports.c.created_at >= since)).scalar() or 0
    return {
        "configured": bool(settings.sms_gateway_signing_key),
        "reply_enabled": sms_gateway.reply_enabled(settings),
        "has_credentials": bool(settings.sms_gateway_username and settings.sms_gateway_password),
        "webhook_path": sms_gateway.WEBHOOK_PATH,
        "last_received_at": last,
        "received_24h": recent,
    }


@router.post("/sms-gateway/register", response_model=SmsGatewayRegistered, dependencies=reviewer)
async def gateway_register(body: SmsGatewayRegister, request: Request):
    """Register this backend's webhook with the gateway's cloud service. Credentials typed in the
    dashboard are used for this one call and never stored."""
    settings = request.app.state.settings
    if not settings.sms_gateway_signing_key:
        raise APIError(409, "CHANNEL_NOT_CONFIGURED", "Set SMS_GATEWAY_SIGNING_KEY in .env first.")
    username = (body.username or "").strip() or settings.sms_gateway_username
    password = body.password or settings.sms_gateway_password
    if not username or not password:
        raise APIError(400, "VALIDATION_ERROR", "Enter the gateway's Cloud Server username and password.")
    try:
        result = await sms_gateway.register_webhook(settings, body.public_url, username, password)
    except sms_gateway.GatewayRejected as exc:
        raise APIError(exc.status, exc.code, exc.message) from exc
    with request.app.state.engine.begin() as conn:
        audit.record(conn, "sms-gateway", "webhook_registered",
                     details={"webhook_url": result["webhook_url"], "replaced": result["replaced"]})
    return result


@router.post("/inbound/sms-gateway")
async def inbound_sms_gateway(request: Request, background: BackgroundTasks):
    settings = request.app.state.settings
    raw = await request.body()
    try:
        sms_gateway.verify(settings, raw, request.headers.get("X-Signature", ""),
                           request.headers.get("X-Timestamp", ""))
    except sms_gateway.GatewayRejected as exc:
        raise APIError(exc.status, exc.code, exc.message) from exc

    try:
        event = json.loads(raw)
        payload = event.get("payload") or {}
    except (ValueError, AttributeError) as exc:
        raise APIError(400, "VALIDATION_ERROR", "Body must be the gateway's JSON event.") from exc
    if event.get("event") != "sms:received":
        return Response(status_code=204)  # other gateway events (sent, delivered, ...) are not reports
    text = str(payload.get("message") or "").strip()
    sender = str(payload.get("sender") or "").strip()
    if not text or sum(c.isdigit() for c in sender) < 5:
        return Response(status_code=204)

    with request.app.state.engine.connect() as conn:
        helpline = helplines.match(conn, payload.get("recipient"))
    # The envelope id is reused when the gateway retries, so a retry never creates a second report.
    message_id = event.get("id") or payload.get("messageId")
    created = create_report(
        request.app.state.engine, settings, channel="sms", text=text, sender=sender,
        provider_message_id=f"smsgate:{message_id}" if message_id else None, helpline=helpline,
    )
    if created.is_new:
        schedule_extraction(request, background, created.report_id)
        if sms_gateway.reply_enabled(settings):
            sim = payload.get("simNumber") if isinstance(payload.get("simNumber"), int) else None
            background.add_task(sms_gateway.send_reply, settings, sender, reply_text(created.reference, settings), sim)
    return JSONResponse({"reference": created.reference, "duplicate": not created.is_new}, status_code=200)
