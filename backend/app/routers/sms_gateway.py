"""Webhook for SMS forwarded by the Android SMS gateway on the helpline phone."""

import json

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse, Response

from app.errors import APIError
from app.routers.deps import schedule_extraction
from app.services import helplines, sms_gateway
from app.services.channels import create_report, reply_text

router = APIRouter(prefix="/api/inbound", tags=["inbound"])


@router.post("/sms-gateway")
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
