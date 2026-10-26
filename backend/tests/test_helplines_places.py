import httpx
import respx
from fastapi.testclient import TestClient

from app.factory import create_app
from tests.conftest import PASSWORD, make_settings
from tests.test_categories_calls_places import BASE, TOKEN, signed, wav_bytes

MOBILE = "+92 300 1112233"
PROVIDER = "+1 555 010 0199"


# ---------- helplines ----------

def test_organizer_manages_helplines(reviewer):
    assert reviewer.get("/api/helplines").json() == {"items": []}
    resp = reviewer.post("/api/helplines", json={"number": "0300-1112233", "label": "Main helpline",
                                                 "provider_number": PROVIDER})
    assert resp.status_code == 201
    h = resp.json()
    assert h["number"] == "+923001112233" and h["provider_number"] == "+15550100199" and h["active"] is True
    assert reviewer.post("/api/helplines", json={"number": MOBILE, "label": "Again"}).status_code == 409
    assert reviewer.post("/api/helplines", json={"number": "call me", "label": "Bad"}).status_code == 400

    # the public list shows active numbers only, without the provider number
    assert reviewer.get("/api/helplines").json() == {"items": [{"number": "+923001112233", "label": "Main helpline"}]}
    resp = reviewer.patch(f"/api/helplines/{h['id']}", json={"active": False, "label": "Old line"})
    assert resp.json()["active"] is False and resp.json()["label"] == "Old line"
    assert reviewer.get("/api/helplines").json() == {"items": []}
    assert len(reviewer.get("/api/helplines/all").json()["items"]) == 1
    assert reviewer.patch("/api/helplines/nope", json={"active": True}).status_code == 404


def test_helpline_admin_needs_sign_in(client):
    assert client.get("/api/helplines").status_code == 200
    assert client.get("/api/helplines/all").status_code == 401
    assert client.post("/api/helplines", json={"number": MOBILE, "label": "Main"}).status_code == 401


def test_simulated_call_records_helpline(reviewer):
    reviewer.post("/api/helplines", json={"number": MOBILE, "label": "Main helpline"})
    resp = reviewer.post("/api/simulator/call", data={"from": "+923004445566", "to": "03001112233",
                                                      "transcript_hint": "Saddar Rawalpindi mein pani chahiye"},
                         files={"audio": ("call.wav", wav_bytes(), "audio/wav")})
    assert resp.status_code == 200
    report = reviewer.get(f"/api/reports/{resp.json()['report_id']}").json()
    assert report["call"]["helpline"] == {"number": "+923001112233", "label": "Main helpline"}
    bad = reviewer.post("/api/simulator/call", data={"from": "+923004445566", "to": "+923009999999"},
                        files={"audio": ("call.wav", wav_bytes(), "audio/wav")})
    assert bad.status_code == 400


@respx.mock
def test_real_call_is_matched_to_helpline_by_provider_number(tmp_path):
    settings = make_settings(tmp_path, twilio_validate_signature=True, twilio_auth_token=TOKEN,
                             twilio_account_sid="AC1", public_base_url=BASE)
    respx.get("https://api.twilio.com/rec/RE9.wav").mock(return_value=httpx.Response(200, content=wav_bytes()))
    with TestClient(create_app(settings)) as c:
        c.post("/api/auth/login", json={"password": PASSWORD})
        c.post("/api/helplines", json={"number": MOBILE, "label": "Main helpline", "provider_number": PROVIDER})
        # the mobile forwards to the Twilio number, so Twilio's To is the provider number
        signed(c, "/api/inbound/voice", {"CallSid": "CA9", "From": "+923004445566", "To": "+15550100199"})
        signed(c, "/api/inbound/voice/recording", {"CallSid": "CA9", "RecordingSid": "RE9",
                                                   "RecordingStatus": "completed",
                                                   "RecordingUrl": "https://api.twilio.com/rec/RE9"})
        rid = c.get("/api/reports").json()["items"][0]["id"]
        assert c.get(f"/api/reports/{rid}").json()["call"]["helpline"]["label"] == "Main helpline"


@respx.mock
def test_call_to_unknown_number_is_still_recorded(tmp_path):
    settings = make_settings(tmp_path, twilio_account_sid="AC1", public_base_url=BASE)
    respx.get("https://api.twilio.com/rec/RE8.wav").mock(return_value=httpx.Response(200, content=wav_bytes()))
    with TestClient(create_app(settings)) as c:
        c.post("/api/inbound/voice", data={"CallSid": "CA8", "From": "+923004445566", "To": "+15550000000"})
        c.post("/api/inbound/voice/recording", data={"CallSid": "CA8", "RecordingSid": "RE8",
                                                     "RecordingStatus": "completed",
                                                     "RecordingUrl": "https://api.twilio.com/rec/RE8"})
        c.post("/api/auth/login", json={"password": PASSWORD})
        rid = c.get("/api/reports").json()["items"][0]["id"]
        assert c.get(f"/api/reports/{rid}").json()["call"]["helpline"] is None


# ---------- place suggestions ----------

PHOTON = {"features": [
    {"geometry": {"coordinates": [73.056, 33.581]},
     "properties": {"name": "Lalkurti", "city": "Rawalpindi", "state": "Punjab", "countrycode": "PK"}},
    {"geometry": {"coordinates": [73.056, 33.581]},
     "properties": {"name": "Lalkurti", "city": "Rawalpindi", "state": "Punjab", "countrycode": "PK"}},
    {"geometry": {"coordinates": [77.2, 28.6]},
     "properties": {"name": "Lal Kuan", "city": "Delhi", "countrycode": "IN"}},
]}


@respx.mock
def test_place_suggestions_from_osm(tmp_path):
    route = respx.get("https://photon.komoot.io/api/").mock(return_value=httpx.Response(200, json=PHOTON))
    with TestClient(create_app(make_settings(tmp_path, geocoder_enabled=True))) as c:
        body = c.get("/api/places/suggest", params={"q": "lalkurt"}).json()
        assert c.get("/api/places/suggest", params={"q": "lalkurt"}).status_code == 200  # cached
        assert c.get("/api/places/suggest", params={"q": "la"}).status_code == 400
    assert body == {"provider": "osm", "items": [
        {"label": "Lalkurti, Rawalpindi, Punjab", "name": "Lalkurti", "lat": 33.581, "lng": 73.056}]}
    assert route.call_count == 1
    assert route.calls[0].request.url.params["bbox"] == "60.87,23.69,77.84,37.08"


@respx.mock
def test_place_suggestions_from_google(tmp_path):
    route = respx.post("https://places.googleapis.com/v1/places:autocomplete").mock(return_value=httpx.Response(
        200, json={"suggestions": [{"placePrediction": {
            "text": {"text": "Lalkurti, Rawalpindi, Pakistan"},
            "structuredFormat": {"mainText": {"text": "Lalkurti"}}}}]}))
    settings = make_settings(tmp_path, geocoder_enabled=True, google_maps_api_key="test-key")
    with TestClient(create_app(settings)) as c:
        body = c.get("/api/places/suggest", params={"q": "lalkurti"}).json()
    assert body["provider"] == "google"
    assert body["items"] == [{"label": "Lalkurti, Rawalpindi, Pakistan", "name": "Lalkurti", "lat": None, "lng": None}]
    assert route.calls[0].request.headers["X-Goog-Api-Key"] == "test-key"
