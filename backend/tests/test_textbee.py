import json

import httpx
import respx
from fastapi.testclient import TestClient

from app.factory import create_app
from app.services.textbee import sign
from tests.conftest import PASSWORD, make_settings

SECRET = "textbee-signing-secret-0123456789"
API = "https://api.textbee.dev/api/v1"
TEXT = "Saddar Rawalpindi mein pani aa gaya hai, 3 bachay hain, khana chahiye"


def event(text=TEXT, sender="+923004445566", key="8f7e6d5c-4b3a-4c1d-8e9f-8a7b6c5d4e3f", kind="MESSAGE_RECEIVED"):
    return {"smsId": "66f7c1e2a4d5e6f7a8b9c0d1", "message": text, "deviceId": "dev1",
            "webhookSubscriptionId": "sub1", "webhookEvent": kind, "idempotencyKey": key,
            "sender": sender, "receivedAt": "2026-10-26T09:14:03.000Z"}


def post(client, body: dict, secret=SECRET, headers=None):
    raw = json.dumps(body).encode()
    return client.post("/api/inbound/textbee", content=raw,
                       headers={"Content-Type": "application/json", "X-Signature": sign(secret, raw),
                                **(headers or {})})


def app_client(tmp_path, **overrides):
    return TestClient(create_app(make_settings(tmp_path, textbee_signing_secret=SECRET, **overrides)))


def test_textbee_sms_becomes_queue_report(tmp_path):
    with app_client(tmp_path) as c:
        resp = post(c, event())
        assert resp.status_code == 200 and resp.json()["duplicate"] is False
        assert post(c, event()).json()["duplicate"] is True  # textbee retry, same idempotency key
        # arrives through the tunnel too
        assert post(c, event(key="k2"), headers={"cf-ray": "x", "cf-connecting-ip": "203.0.113.9"}).status_code == 200
        c.post("/api/auth/login", json={"password": PASSWORD})
        items = c.get("/api/reports").json()["items"]
        assert len(items) == 2 and {i["channel"] for i in items} == {"sms"}
        report = c.get(f"/api/reports/{items[-1]['id']}").json()
        status = c.get("/api/sms-gateway/status").json()
    assert report["source_text"] == TEXT and report["sender"]["masked"] == "+92 3•• ••• ••66"
    assert [n["category"] for n in report["extraction"]["needs"]] == ["food"]
    assert status["received_24h"] == 2 and status["textbee_configured"] is True


def test_textbee_rejects_bad_signature_and_needs_secret(tmp_path):
    with app_client(tmp_path) as c:
        assert post(c, event(), secret="another-secret-0123456789").status_code == 401
        assert c.post("/api/inbound/textbee", json=event()).status_code == 401
        assert post(c, event(kind="MESSAGE_DELIVERED")).status_code == 204
        assert post(c, event(text=" ", key="k3")).status_code == 204
    with TestClient(create_app(make_settings(tmp_path / "b"))) as c:
        assert post(c, event()).status_code == 503


@respx.mock
def test_textbee_reply_sms(tmp_path):
    route = respx.post(f"{API}/gateway/send-sms").mock(return_value=httpx.Response(201, json={"data": {}}))
    with app_client(tmp_path, textbee_reply=True, textbee_api_key="tb-key") as c:
        ref = post(c, event()).json()["reference"]
        post(c, event())  # retry: no second reply
    assert route.call_count == 1
    sent = json.loads(route.calls[0].request.content)
    assert sent["recipients"] == ["+923004445566"] and sent["deviceId"] == "dev1" and ref in sent["message"]
    assert route.calls[0].request.headers["x-api-key"] == "tb-key"


@respx.mock
def test_textbee_connect_creates_then_moves_webhook(tmp_path):
    listing = respx.get(f"{API}/webhooks")
    listing.side_effect = [
        httpx.Response(200, json={"data": []}),
        httpx.Response(200, json={"data": [{"_id": "w1", "deliveryUrl": "https://a.trycloudflare.com/api/inbound/textbee"}]}),
    ]
    created = respx.post(f"{API}/webhooks").mock(return_value=httpx.Response(201, json={"data": {"_id": "w1"}}))
    moved = respx.patch(f"{API}/webhooks/w1").mock(return_value=httpx.Response(200, json={"data": {"_id": "w1"}}))
    with app_client(tmp_path) as c:
        c.post("/api/auth/login", json={"password": PASSWORD})
        first = c.post("/api/sms-gateway/textbee/register",
                       json={"public_url": "https://a.trycloudflare.com", "api_key": "tb-key"}).json()
        second = c.post("/api/sms-gateway/textbee/register",
                        json={"public_url": "https://b.trycloudflare.com/", "api_key": "tb-key"}).json()
    assert first == {"webhook_url": "https://a.trycloudflare.com/api/inbound/textbee", "webhook_id": "w1",
                     "replaced": 0}
    assert second["webhook_url"] == "https://b.trycloudflare.com/api/inbound/textbee" and second["replaced"] == 1
    body = json.loads(created.calls[0].request.content)
    assert body == {"deliveryUrl": "https://a.trycloudflare.com/api/inbound/textbee", "signingSecret": SECRET,
                    "events": ["MESSAGE_RECEIVED"], "name": "ReliefLens"}
    assert json.loads(moved.calls[0].request.content)["deliveryUrl"].startswith("https://b.trycloudflare.com")
    assert created.calls[0].request.headers["x-api-key"] == "tb-key"


@respx.mock
def test_textbee_connect_errors(tmp_path):
    respx.get(f"{API}/webhooks").mock(return_value=httpx.Response(401))
    with app_client(tmp_path) as c:
        c.post("/api/auth/login", json={"password": PASSWORD})
        bad = c.post("/api/sms-gateway/textbee/register", json={"public_url": "https://a.trycloudflare.com",
                                                                 "api_key": "wrong"})
        assert bad.json()["error"]["code"] == "GATEWAY_AUTH_FAILED"
        assert c.post("/api/sms-gateway/textbee/register",
                      json={"public_url": "https://a.trycloudflare.com"}).status_code == 400
