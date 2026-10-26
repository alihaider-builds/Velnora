"""SMS to an ordinary SIM through "SMS Gateway for Android" (https://sms-gate.app, open source).

The helpline SIM stays in an Android phone running the app. For every received SMS it posts a
signed `sms:received` webhook; we verify it and create an SMS report. Optionally we send the
bilingual reply (with the reference) back through the gateway's API, from the same SIM.

Signature (https://docs.sms-gate.app/features/webhooks/): X-Signature is the hex HMAC-SHA256 of
the raw body followed by the X-Timestamp value, keyed with the app's webhook signing key.
"""

import hashlib
import hmac
import logging
import time

import httpx

from app.config import Settings

log = logging.getLogger("relieflens.sms_gateway")
MAX_CLOCK_SKEW = 300  # seconds, as the gateway docs recommend


class GatewayRejected(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def sign(key: str, body: bytes, timestamp: str) -> str:
    return hmac.new(key.encode(), body + timestamp.encode(), hashlib.sha256).hexdigest()


def verify(settings: Settings, body: bytes, signature: str, timestamp: str, now: float | None = None) -> None:
    if not settings.sms_gateway_signing_key:
        raise GatewayRejected(503, "CHANNEL_NOT_CONFIGURED", "Set SMS_GATEWAY_SIGNING_KEY first.")
    try:
        skew = abs((now or time.time()) - int(timestamp))
    except ValueError as exc:
        raise GatewayRejected(403, "INVALID_SIGNATURE", "Missing or bad timestamp.") from exc
    if skew > MAX_CLOCK_SKEW:
        raise GatewayRejected(403, "INVALID_SIGNATURE", "Request timestamp is too old.")
    expected = sign(settings.sms_gateway_signing_key, body, timestamp)
    if not hmac.compare_digest(expected, signature.strip().lower()):
        raise GatewayRejected(403, "INVALID_SIGNATURE", "Request signature is not valid.")


def reply_enabled(settings: Settings) -> bool:
    return bool(settings.sms_gateway_reply and settings.sms_gateway_username and settings.sms_gateway_password)


async def send_reply(settings: Settings, to: str, text: str, sim_number: int | None = None) -> None:
    """Send the acknowledgement SMS from the helpline phone. Failures are logged, never raised:
    the report is already safely in the queue."""
    body: dict = {"textMessage": {"text": text}, "phoneNumbers": [to]}
    if sim_number:
        body["simNumber"] = sim_number
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(f"{settings.sms_gateway_api_url.rstrip('/')}/messages", json=body,
                                     auth=(settings.sms_gateway_username, settings.sms_gateway_password))
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("reply SMS could not be sent: %s", type(exc).__name__)


WEBHOOK_PATH = "/api/inbound/sms-gateway"


async def register_webhook(settings: Settings, public_url: str, username: str, password: str) -> dict:
    """Point the gateway's sms:received webhook at this backend. Quick-tunnel URLs change on every
    start, so older registrations for our path are removed first."""
    base = settings.sms_gateway_api_url.rstrip("/")
    url = public_url.rstrip("/") + WEBHOOK_PATH
    auth = (username, password)
    replaced = 0
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            existing = await client.get(f"{base}/webhooks", auth=auth)
            if existing.status_code == 401:
                raise GatewayRejected(400, "GATEWAY_AUTH_FAILED", "The gateway username or password is wrong.")
            existing.raise_for_status()
            for hook in existing.json() or []:
                if hook.get("event") == "sms:received" and str(hook.get("url", "")).endswith(WEBHOOK_PATH):
                    (await client.delete(f"{base}/webhooks/{hook['id']}", auth=auth)).raise_for_status()
                    replaced += 1
            resp = await client.post(f"{base}/webhooks", auth=auth, json={"url": url, "event": "sms:received"})
            resp.raise_for_status()
            created = resp.json() if resp.content else {}
    except httpx.HTTPError as exc:
        raise GatewayRejected(502, "GATEWAY_UNAVAILABLE", "Couldn't reach the SMS gateway service.") from exc
    return {"webhook_url": url, "webhook_id": created.get("id"), "replaced": replaced}
