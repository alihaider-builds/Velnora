import json
import time

import httpx
import respx
from fastapi.testclient import TestClient

from app.factory import create_app
from app.services.sms_gateway import sign
from tests.conftest import PASSWORD, make_settings

KEY = "gateway-signing-key"
API = "https://api.sms-gate.app/3rdparty/v1"
TEXT = "Lalkurti Cantt Rawalpindi mein pani bhar gaya hai, 3 bachay hain, dawai chahiye"


def event(text=TEXT, sender="+923004445566", envelope="Ey6ECgOkVVFjz3CL48B8C", kind="sms:received"):
    return {"deviceId": "dev1", "event": kind, "id": envelope, "webhookId": "wh1",
            "payload": {"messageId": "abc123", "message": text, "sender": sender, "recipient": "+923260175097",
                        "simNumber": 1, "receivedAt": "2026-10-26T15:46:11.000+05:00"}}


def post(client, body: dict, key=KEY, timestamp=None):
    raw = json.dumps(body).encode()
    ts = str(int(timestamp if timestamp is not None else time.time()))
    return client.post("/api/inbound/sms-gateway", content=raw,
                       headers={"Content-Type": "application/json", "X-Timestamp": ts,
                                "X-Signature": sign(key, raw, ts)})


def app_client(tmp_path, **overrides):
    return TestClient(create_app(make_settings(tmp_path, sms_gateway_signing_key=KEY, **overrides)))


def test_forwarded_sms_becomes_queue_report(tmp_path):
    with app_client(tmp_path) as c:
        c.post("/api/auth/login", json={"password": PASSWORD})
        c.post("/api/helplines", json={"number": "+92 326 0175097", "label": "ReliefLens helpline"})
        resp = post(c, event())
        assert resp.status_code == 200 and resp.json()["reference"].startswith("RL-")
        assert post(c, event()).json()["duplicate"] is True  # gateway retry reuses the envelope id

        items = c.get("/api/reports").json()["items"]
        assert len(items) == 1 and items[0]["channel"] == "sms"
        report = c.get(f"/api/reports/{items[0]['id']}").json()
    assert report["source_text"] == TEXT
    assert report["sender"]["masked"] == "+92 3•• ••• ••66"
    assert report["extraction"]["status"] == "succeeded"
    assert report["extraction"]["place_name"]["text"] == "Lalkurti Cantt Rawalpindi"


def test_rejects_bad_signature_and_stale_timestamp(tmp_path):
    with app_client(tmp_path) as c:
        assert post(c, event(), key="wrong-key").status_code == 403
        assert post(c, event(), timestamp=time.time() - 3600).status_code == 403
        assert c.post("/api/inbound/sms-gateway", json=event()).status_code == 403  # unsigned
        c.post("/api/auth/login", json={"password": PASSWORD})
        assert c.get("/api/reports").json()["items"] == []


def test_needs_signing_key(tmp_path):
    with TestClient(create_app(make_settings(tmp_path))) as c:
        assert post(c, event()).status_code == 503


def test_ignores_other_events_and_empty_messages(tmp_path):
    with app_client(tmp_path) as c:
        assert post(c, event(kind="sms:delivered")).status_code == 204
        assert post(c, event(text="   ", envelope="e2")).status_code == 204
        assert post(c, event(sender="", envelope="e3")).status_code == 204


@respx.mock
def test_reply_sms_sent_through_gateway_when_enabled(tmp_path):
    route = respx.post(f"{API}/messages").mock(return_value=httpx.Response(202, json={"id": "m1"}))
    with app_client(tmp_path, sms_gateway_reply=True, sms_gateway_username="user",
                    sms_gateway_password="pass") as c:
        ref = post(c, event()).json()["reference"]
        post(c, event())  # retry: no second reply
    assert route.call_count == 1
    sent = json.loads(route.calls[0].request.content)
    assert sent["phoneNumbers"] == ["+923004445566"] and sent["simNumber"] == 1
    assert ref in sent["textMessage"]["text"] and "1122" in sent["textMessage"]["text"]
    assert route.calls[0].request.headers["Authorization"].startswith("Basic ")


@respx.mock
def test_reply_failure_keeps_the_report(tmp_path):
    respx.post(f"{API}/messages").mock(return_value=httpx.Response(500))
    with app_client(tmp_path, sms_gateway_reply=True, sms_gateway_username="u", sms_gateway_password="p") as c:
        assert post(c, event()).status_code == 200
        c.post("/api/auth/login", json={"password": PASSWORD})
        assert len(c.get("/api/reports").json()["items"]) == 1
