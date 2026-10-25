import httpx
import respx
from fastapi.testclient import TestClient

from app.factory import create_app
from app.routers.inbound import twilio_signature
from tests.conftest import DEMO_TEXT, PASSWORD, make_settings

BASE = "https://relief.example.test"
TOKEN = "twilio-test-token"


def twilio_client(tmp_path, **overrides):
    settings = make_settings(tmp_path, twilio_validate_signature=True, twilio_auth_token=TOKEN,
                             public_base_url=BASE, **overrides)
    return TestClient(create_app(settings))


def signed_post(client, path, params, token=TOKEN):
    sig = twilio_signature(token, BASE + path, params)
    return client.post(path, data=params, headers={"X-Twilio-Signature": sig})


SMS = {"MessageSid": "SM123", "From": "+923001234541", "To": "+15550001111", "Body": DEMO_TEXT, "NumMedia": "0"}


def test_signed_sms_creates_report_and_replies(tmp_path):
    with twilio_client(tmp_path) as c:
        resp = signed_post(c, "/api/inbound/sms", SMS)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/xml")
        assert "<Response><Message>Shukriya!" in resp.text and "1122" in resp.text
        c.post("/api/auth/login", json={"password": PASSWORD})
        items = c.get("/api/reports").json()["items"]
        assert len(items) == 1 and items[0]["channel"] == "sms"


def test_bad_signature_is_rejected(tmp_path):
    with twilio_client(tmp_path) as c:
        resp = signed_post(c, "/api/inbound/sms", SMS, token="wrong-token")
        assert resp.status_code == 403 and resp.json()["error"]["code"] == "INVALID_SIGNATURE"
        assert c.post("/api/inbound/sms", data=SMS).status_code == 403


def test_twilio_retry_is_idempotent(tmp_path):
    with twilio_client(tmp_path) as c:
        first = signed_post(c, "/api/inbound/sms", SMS).text
        second = signed_post(c, "/api/inbound/sms", SMS).text
        assert first == second
        c.post("/api/auth/login", json={"password": PASSWORD})
        assert c.get("/api/reports").json()["total"] == 1


def test_whatsapp_prefix_is_stripped(tmp_path):
    params = {**SMS, "MessageSid": "SM999", "From": "whatsapp:+923001234541", "To": "whatsapp:+14155238886"}
    with twilio_client(tmp_path) as c:
        assert signed_post(c, "/api/inbound/whatsapp", params).status_code == 200
        c.post("/api/auth/login", json={"password": PASSWORD})
        rid = c.get("/api/reports").json()["items"][0]["id"]
        report = c.get(f"/api/reports/{rid}").json()
        assert report["channel"] == "whatsapp"
        assert report["sender"]["masked"] == "+92 3•• ••• ••41"
        assert c.get(f"/api/reports/{rid}/original").json()["sender"] == "+923001234541"


def test_webhook_needs_configuration_when_validating(tmp_path):
    settings = make_settings(tmp_path, twilio_validate_signature=True)
    with TestClient(create_app(settings)) as c:
        assert c.post("/api/inbound/sms", data=SMS).status_code == 503


def test_simulator_only_in_demo_mode(tmp_path):
    settings = make_settings(tmp_path, demo_mode=False)
    with TestClient(create_app(settings)) as c:
        resp = c.post("/api/simulator/send", json={"channel": "sms", "from": "+923000000001", "body": "hello there"})
        assert resp.status_code == 404


def test_simulator_reply_and_validation(client):
    resp = client.post("/api/simulator/send", json={"channel": "sms", "from": "+923000000001", "body": DEMO_TEXT})
    body = resp.json()
    assert resp.status_code == 200 and body["reference"] in body["reply"]
    bad = client.post("/api/simulator/send", json={"channel": "fax", "from": "+923000000001", "body": "x"})
    assert bad.status_code == 400
    bad = client.post("/api/simulator/send", json={"channel": "sms", "from": "abcdef", "body": "hello"})
    assert bad.status_code == 400


def test_rate_limit_on_submit(tmp_path):
    settings = make_settings(tmp_path, rate_limit_enabled=True)
    with TestClient(create_app(settings)) as c:
        codes = [c.post("/api/reports", data={"text": DEMO_TEXT}).status_code for _ in range(11)]
        assert codes[:10] == [201] * 10 and codes[10] == 429


NOMINATIM = [
    {"lat": "34.4931", "lon": "72.3068", "display_name": "Pir Baba, Buner District, Khyber Pakhtunkhwa, Pakistan",
     "addresstype": "village", "importance": 0.41},
]


@respx.mock
def test_geocode_calls_nominatim_once_then_caches(tmp_path):
    route = respx.get("https://nominatim.openstreetmap.org/search").mock(
        return_value=httpx.Response(200, json=NOMINATIM))
    settings = make_settings(tmp_path, geocoder_enabled=True)
    with TestClient(create_app(settings)) as c:
        c.post("/api/auth/login", json={"password": PASSWORD})
        first = c.get("/api/geocode", params={"q": "Pir Baba Buner"}).json()
        second = c.get("/api/geocode", params={"q": "pir baba, BUNER"}).json()
    assert first == second
    assert first["candidates"][0] == {"lat": 34.4931, "lng": 72.3068, "label": NOMINATIM[0]["display_name"],
                                      "type": "village", "importance": 0.41}
    assert route.call_count == 1
    sent = route.calls[0].request
    assert sent.url.params["countrycodes"] == "pk"
    assert "ReliefLens" in sent.headers["user-agent"]


@respx.mock
def test_geocoder_down_returns_502(tmp_path):
    respx.get("https://nominatim.openstreetmap.org/search").mock(return_value=httpx.Response(503))
    settings = make_settings(tmp_path, geocoder_enabled=True)
    with TestClient(create_app(settings)) as c:
        c.post("/api/auth/login", json={"password": PASSWORD})
        resp = c.get("/api/geocode", params={"q": "Buner"})
    assert resp.status_code == 502 and resp.json()["error"]["code"] == "GEOCODER_UNAVAILABLE"


@respx.mock
def test_extraction_suggests_location(tmp_path):
    respx.get("https://nominatim.openstreetmap.org/search").mock(return_value=httpx.Response(200, json=NOMINATIM))
    settings = make_settings(tmp_path, geocoder_enabled=True)
    with TestClient(create_app(settings)) as c:
        rid = c.post("/api/simulator/send", json={"channel": "sms", "from": "+923000000001",
                                                    "body": DEMO_TEXT}).json()["report_id"]
        c.post("/api/auth/login", json={"password": PASSWORD})
        loc = c.get(f"/api/reports/{rid}").json()["location"]
    assert loc["suggested"]["source"] == "geocoder_candidate"
    assert loc["suggested"]["lat"] == 34.4931 and loc["confirmed"] is None
