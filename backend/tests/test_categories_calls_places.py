import io
import math
import struct
import wave

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.factory import create_app
from app.routers.inbound import twilio_signature
from app.services.geocoding import query_variants
from app.services.llm.fake import extract_place, heuristic_extract
from tests.conftest import PASSWORD, make_settings, send


def wav_bytes(seconds=1.0, rate=8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = b"".join(struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * i / rate)))
                          for i in range(int(seconds * rate)))
        w.writeframes(frames)
    return buf.getvalue()


# ---------- categories ----------

def test_builtin_categories_are_public(client):
    keys = [c["key"] for c in client.get("/api/categories").json()["items"]]
    assert keys == ["food", "clean_water", "shelter", "medicine", "evacuation", "other"]
    assert client.get("/api/categories", params={"include_inactive": True}).status_code == 401


def test_organizer_adds_category_and_ai_uses_it(reviewer):
    resp = reviewer.post("/api/categories", json={"label": "Blankets", "label_ur": "کمبل",
                                                  "keywords": ["kambal", "razai", "blanket"]})
    assert resp.status_code == 201
    cat = resp.json()
    assert cat["key"] == "blankets" and cat["builtin"] is False and cat["keywords"] == ["kambal", "razai", "blanket"]
    assert reviewer.post("/api/categories", json={"label": "blankets"}).status_code == 409

    rid = send(reviewer, body="Swat mein bohat sardi hai, 4 bachay hain, kambal chahiye")
    needs = [n["category"] for n in reviewer.get(f"/api/reports/{rid}").json()["extraction"]["needs"]]
    assert needs == ["blankets"]
    # reviewer can assign the new category; unknown ones are rejected
    assert reviewer.patch(f"/api/reports/{rid}/fields", json={"needs": ["blankets", "food"]}).status_code == 200
    assert reviewer.patch(f"/api/reports/{rid}/fields", json={"needs": ["money"]}).status_code == 400


def test_turned_off_category_is_not_used_by_ai(reviewer):
    resp = reviewer.patch("/api/categories/food", json={"active": False})
    assert resp.status_code == 200 and resp.json()["active"] is False
    rid = send(reviewer, body="Dadu mein khana aur dawai chahiye")
    needs = [n["category"] for n in reviewer.get(f"/api/reports/{rid}").json()["extraction"]["needs"]]
    assert needs == ["medicine"]
    assert "food" not in [c["key"] for c in reviewer.get("/api/categories").json()["items"]]
    assert "food" in [c["key"] for c in reviewer.get("/api/categories?include_inactive=true").json()["items"]]
    assert reviewer.patch("/api/categories/other", json={"active": False}).status_code == 409
    assert reviewer.patch("/api/categories/nope", json={"label": "Xx"}).status_code == 404


def test_category_writes_require_sign_in(client):
    assert client.post("/api/categories", json={"label": "Blankets"}).status_code == 401
    assert client.patch("/api/categories/food", json={"active": False}).status_code == 401


def test_urdu_only_label_gets_a_safe_key(reviewer):
    cat = reviewer.post("/api/categories", json={"label": "کمبل"}).json()
    assert cat["key"].startswith("cat_")


# ---------- calls ----------

def call(client, hint=None, data=None):
    files = {"audio": ("call.wav", data or wav_bytes(), "audio/wav")}
    form = {"from": "+923001112233"}
    if hint:
        form["transcript_hint"] = hint
    return client.post("/api/simulator/call", data=form, files=files)


def test_simulated_call_with_demo_transcript_is_extracted(reviewer):
    resp = call(reviewer, hint="Hum lalkurti cantt rawalpindi mein hain, 3 bachay hain, dawai chahiye")
    assert resp.status_code == 200
    body = resp.json()
    assert "call record" in body["reply"] and body["reference"] in body["reply"]
    report = reviewer.get(f"/api/reports/{body['report_id']}").json()
    assert report["channel"] == "call"
    assert report["call"]["transcript_status"] == "succeeded"
    assert report["call"]["transcript_model"] == "typed-demo-transcript"
    assert report["call"]["duration_seconds"] == pytest.approx(1.0)
    assert report["extraction"]["place_name"]["text"] == "Lalkurti Cantt Rawalpindi"
    audio = reviewer.get(report["call"]["audio_url"])
    assert audio.status_code == 200 and audio.headers["content-type"] == "audio/wav"


def test_call_without_speech_model_waits_for_reviewer_transcript(reviewer):
    rid = call(reviewer).json()["report_id"]
    report = reviewer.get(f"/api/reports/{rid}").json()
    assert report["call"]["transcript_status"] == "failed"
    assert "type the transcript" in report["call"]["transcript_error"]
    assert report["extraction"]["status"] == "failed" and report["source_text"] == ""
    assert reviewer.post(f"/api/reports/{rid}/retry-extraction").status_code == 409

    resp = reviewer.put(f"/api/reports/{rid}/transcript", json={"text": "Buner mein saaf pani chahiye"})
    assert resp.status_code == 200
    report = reviewer.get(f"/api/reports/{rid}").json()
    assert report["call"]["transcript_status"] == "manual"
    assert report["extraction"]["status"] == "succeeded"
    assert [n["category"] for n in report["extraction"]["needs"]] == ["clean_water"]
    assert "edit_transcript" in [a["action"] for a in report["audit"]]
    item = reviewer.get("/api/reports").json()["items"][0]
    assert item["channel"] == "call" and item["transcript_status"] == "manual"


def test_transcript_only_for_calls(reviewer):
    rid = send(reviewer)
    assert reviewer.put(f"/api/reports/{rid}/transcript", json={"text": "x"}).status_code == 409


def test_call_audio_is_validated(client):
    resp = call(client, data=b"not audio at all")
    assert resp.status_code == 415 and resp.json()["error"]["code"] == "UNSUPPORTED_AUDIO"


def test_call_too_long_is_rejected(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, max_call_seconds=1))) as c:
        assert call(c, data=wav_bytes(seconds=2)).status_code == 413


def test_call_simulator_only_in_demo_mode(tmp_path):
    with TestClient(create_app(make_settings(tmp_path, demo_mode=False))) as c:
        assert call(c).status_code == 404


def test_deleting_call_removes_audio(reviewer, settings):
    rid = call(reviewer, hint="Swat mein khana chahiye").json()["report_id"]
    folder = settings.resolve(settings.upload_dir)
    assert any(folder.glob("*.wav"))
    assert reviewer.delete(f"/api/reports/{rid}").status_code == 204
    assert not any(folder.glob("*.wav"))


BASE = "https://relief.example.test"
TOKEN = "twilio-test-token"


def signed(client, path, params):
    return client.post(path, data=params, headers={"X-Twilio-Signature": twilio_signature(TOKEN, BASE + path, params)})


@respx.mock
def test_twilio_voice_flow(tmp_path):
    settings = make_settings(tmp_path, twilio_validate_signature=True, twilio_auth_token=TOKEN,
                             twilio_account_sid="AC1", public_base_url=BASE)
    respx.get("https://api.twilio.com/rec/RE1.wav").mock(return_value=httpx.Response(200, content=wav_bytes()))
    with TestClient(create_app(settings)) as c:
        twiml = signed(c, "/api/inbound/voice", {"CallSid": "CA1", "From": "+923004445566", "To": "+1555"})
        assert twiml.status_code == 200
        assert "<Record" in twiml.text and "recorded" in twiml.text
        assert f'recordingStatusCallback="{BASE}/api/inbound/voice/recording"' in twiml.text
        done = signed(c, "/api/inbound/voice/done", {"CallSid": "CA1"})
        assert "<Hangup/>" in done.text
        params = {"CallSid": "CA1", "RecordingSid": "RE1", "RecordingStatus": "completed",
                  "RecordingUrl": "https://api.twilio.com/rec/RE1", "RecordingDuration": "1"}
        assert signed(c, "/api/inbound/voice/recording", params).status_code == 204
        assert signed(c, "/api/inbound/voice/recording", params).status_code == 204  # retry: no duplicate
        assert c.post("/api/inbound/voice", data={"CallSid": "CA2"}).status_code == 403  # unsigned
        c.post("/api/auth/login", json={"password": PASSWORD})
        items = c.get("/api/reports").json()["items"]
        assert len(items) == 1 and items[0]["channel"] == "call"
        report = c.get(f"/api/reports/{items[0]['id']}").json()
        assert report["sender"]["masked"] == "+92 3•• ••• ••66"
        assert report["call"]["has_audio"] is True


# ---------- places ----------

@pytest.mark.parametrize("text,expected", [
    ("hum lalkurti cantt rawalpindi mein hain, pani bhar gaya", "lalkurti cantt rawalpindi"),
    ("Lalkurti, Cantt, Rawalpindi mein 3 ghar gir gaye", "Lalkurti, Cantt, Rawalpindi"),
    ("Pir Baba ke qareeb 12 log phanse hain", "Pir Baba"),
    ("Flood water entered our street in Rajanpur. We need water", "Rajanpur"),
    ("D.I. Khan mein flood ki wajah se", "D.I. Khan"),
    ("Sector G-9 Islamabad mein basement mein pani", "Sector G-9 Islamabad"),
    ("near Saddar Rawalpindi we are stuck", "Saddar Rawalpindi"),
    ("سکھر میں ہمارے محلے میں راشن ختم", "سکھر"),
])
def test_place_phrases(text, expected):
    assert extract_place(text)["evidence"]["phrase"] == expected


@pytest.mark.parametrize("text", ["Hamare gaon mein khana nahi", "help me please", "Mohalle mein pani"])
def test_no_place(text):
    assert extract_place(text) is None


def test_place_evidence_is_grounded_in_full_extraction():
    out = heuristic_extract("hum lalkurti cantt rawalpindi mein hain, 2 buzurg ko dawai chahiye")
    assert out["place_name"] == {"text": "Lalkurti Cantt Rawalpindi",
                                 "evidence": {"phrase": "lalkurti cantt rawalpindi"}}


def test_query_variants_broaden_step_by_step():
    assert query_variants("Lalkurti, Cantt, Rawalpindi") == [
        "Lalkurti, Cantt, Rawalpindi", "Lalkurti, Cantonment, Rawalpindi", "Cantt, Rawalpindi", "Rawalpindi"]


@respx.mock
def test_geocoder_falls_back_to_broader_query(tmp_path):
    route = respx.get("https://nominatim.openstreetmap.org/search")
    route.side_effect = lambda req: httpx.Response(200, json=[] if "Lalkurti" in req.url.params["q"] else [
        {"lat": "33.6", "lon": "73.05", "display_name": "Rawalpindi, Punjab, Pakistan", "addresstype": "city"}])
    with TestClient(create_app(make_settings(tmp_path, geocoder_enabled=True))) as c:
        c.post("/api/auth/login", json={"password": PASSWORD})
        cands = c.get("/api/geocode", params={"q": "Lalkurti, Cantt, Rawalpindi"}).json()["candidates"]
    assert cands[0]["label"].startswith("Rawalpindi")
    assert route.call_count == 3  # full, "Cantonment" spelling, then "Cantt, Rawalpindi" -> found


@respx.mock
def test_google_geocoder_when_key_set(tmp_path):
    route = respx.get("https://maps.googleapis.com/maps/api/geocode/json").mock(return_value=httpx.Response(
        200, json={"status": "OK", "results": [{"formatted_address": "Lalkurti, Rawalpindi, Pakistan",
                                                 "geometry": {"location": {"lat": 33.581, "lng": 73.056}},
                                                 "types": ["neighborhood"]}]}))
    settings = make_settings(tmp_path, geocoder_enabled=True, google_maps_api_key="test-key")
    with TestClient(create_app(settings)) as c:
        assert c.get("/api/health").json()["map_provider"] == "google"
        c.post("/api/auth/login", json={"password": PASSWORD})
        cands = c.get("/api/geocode", params={"q": "Lalkurti Rawalpindi"}).json()["candidates"]
    assert cands == [{"lat": 33.581, "lng": 73.056, "label": "Lalkurti, Rawalpindi, Pakistan",
                      "type": "neighborhood", "importance": None}]
    sent = route.calls[0].request.url.params
    assert sent["components"] == "country:PK" and sent["region"] == "pk"


@respx.mock
def test_google_errors_become_502(tmp_path):
    respx.get("https://maps.googleapis.com/maps/api/geocode/json").mock(
        return_value=httpx.Response(200, json={"status": "REQUEST_DENIED"}))
    settings = make_settings(tmp_path, geocoder_enabled=True, google_maps_api_key="bad")
    with TestClient(create_app(settings)) as c:
        c.post("/api/auth/login", json={"password": PASSWORD})
        assert c.get("/api/geocode", params={"q": "Buner"}).status_code == 502
