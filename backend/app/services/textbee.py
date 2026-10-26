"""SMS to an ordinary SIM through textbee (https://textbee.dev, open source).

The helpline phone runs the textbee app, linked to a textbee.dev account by QR code. textbee
posts a `MESSAGE_RECEIVED` webhook for each SMS; `X-Signature` is the lowercase hex HMAC-SHA256
of the raw body with the subscription's signing secret (https://textbee.dev/docs/webhooks).
We create that subscription ourselves (with our secret), so nobody copies secrets by hand.
"""

import hashlib
import hmac
import logging

import httpx

from app.config import Settings
from app.services.sms_gateway import GatewayRejected

log = logging.getLogger("relieflens.textbee")
WEBHOOK_PATH = "/api/inbound/textbee"
EVENT_RECEIVED = "MESSAGE_RECEIVED"


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def verify(settings: Settings, body: bytes, signature: str) -> None:
    secret = settings.textbee_signing_secret
    if len(secret) < 20:
        raise GatewayRejected(503, "CHANNEL_NOT_CONFIGURED", "Set TEXTBEE_SIGNING_SECRET (20+ characters) first.")
    if not hmac.compare_digest(sign(secret, body), signature.strip().lower()):
        raise GatewayRejected(401, "INVALID_SIGNATURE", "Request signature is not valid.")


def reply_enabled(settings: Settings) -> bool:
    return bool(settings.textbee_reply and settings.textbee_api_key)


def _api(settings: Settings) -> str:
    return settings.textbee_api_url.rstrip("/")


async def send_reply(settings: Settings, to: str, text: str, device_id: str | None = None) -> None:
    """Acknowledgement SMS from the helpline phone; failures are logged, never raised."""
    body: dict = {"recipients": [to], "message": text}
    if device_id:
        body["deviceId"] = device_id
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(f"{_api(settings)}/gateway/send-sms", json=body,
                                     headers={"x-api-key": settings.textbee_api_key})
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("textbee reply SMS could not be sent: %s", type(exc).__name__)


async def register_webhook(settings: Settings, public_url: str, api_key: str) -> dict:
    """Create (or move) the MESSAGE_RECEIVED subscription to this backend. Quick-tunnel URLs
    change on every start, so an existing subscription for our path is updated instead of duplicated."""
    url = public_url.rstrip("/") + WEBHOOK_PATH
    headers = {"x-api-key": api_key}
    body = {"deliveryUrl": url, "signingSecret": settings.textbee_signing_secret, "events": [EVENT_RECEIVED],
            "name": "ReliefLens"}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            listed = await client.get(f"{_api(settings)}/webhooks", headers=headers)
            if listed.status_code in (401, 403):
                raise GatewayRejected(400, "GATEWAY_AUTH_FAILED", "The textbee API key is wrong.")
            listed.raise_for_status()
            ours = [w for w in (listed.json().get("data") or [])
                    if str(w.get("deliveryUrl", "")).endswith(WEBHOOK_PATH)]
            if ours:
                hook_id = ours[0].get("_id") or ours[0].get("id")
                resp = await client.patch(f"{_api(settings)}/webhooks/{hook_id}", headers=headers,
                                          json={**body, "isActive": True})
            else:
                resp = await client.post(f"{_api(settings)}/webhooks", headers=headers, json=body)
            resp.raise_for_status()
            data = (resp.json() or {}).get("data") or {}
    except httpx.HTTPError as exc:
        raise GatewayRejected(502, "GATEWAY_UNAVAILABLE", "Couldn't reach textbee.") from exc
    return {"webhook_url": url, "webhook_id": data.get("_id") or data.get("id"), "replaced": len(ours)}
