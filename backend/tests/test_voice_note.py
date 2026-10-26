"""Web reports can carry the submitter's voice recording for the reviewer to check."""

from tests.conftest import DEMO_TEXT
from tests.test_categories_calls_places import wav_bytes


def submit(client, audio: bytes | None = None, **files):
    if audio is not None:
        files["audio"] = ("voice-note.wav", audio, "audio/wav")
    return client.post("/api/reports", data={"text": DEMO_TEXT}, files=files or None)


def test_voice_note_is_stored_and_only_reviewers_can_hear_it(reviewer):
    resp = submit(reviewer, wav_bytes(seconds=2.0))
    assert resp.status_code == 201
    report_id = resp.json()["id"]

    report = reviewer.get(f"/api/reports/{report_id}").json()
    assert report["channel"] == "web"
    assert report["call"] is None
    assert report["voice_note"]["audio_url"] == f"/api/reports/{report_id}/audio"
    assert round(report["voice_note"]["duration_seconds"]) == 2
    assert report["source_text"] == DEMO_TEXT  # the typed / dictated text is unchanged

    item = next(i for i in reviewer.get("/api/reports").json()["items"] if i["id"] == report_id)
    assert item["has_voice_note"] is True
    assert item["transcript_status"] is None  # no call-style transcription job

    audio = reviewer.get(report["voice_note"]["audio_url"])
    assert audio.status_code == 200 and audio.headers["content-type"] == "audio/wav"

    reviewer.post("/api/auth/logout")
    assert reviewer.get(f"/api/reports/{report_id}/audio").status_code == 401


def test_report_without_voice_note_has_none(reviewer):
    report_id = submit(reviewer).json()["id"]
    assert reviewer.get(f"/api/reports/{report_id}").json()["voice_note"] is None
    item = next(i for i in reviewer.get("/api/reports").json()["items"] if i["id"] == report_id)
    assert item["has_voice_note"] is False


def test_non_wav_voice_note_is_rejected_and_nothing_is_stored(reviewer):
    before = reviewer.get("/api/reports").json()["total"]
    resp = submit(reviewer, b"not really audio")
    assert resp.status_code == 415
    assert resp.json()["error"]["code"] == "UNSUPPORTED_AUDIO"
    assert reviewer.get("/api/reports").json()["total"] == before


def test_overlong_voice_note_is_rejected(reviewer, settings):
    resp = submit(reviewer, wav_bytes(seconds=settings.max_call_seconds + 5, rate=8000))
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] in ("AUDIO_TOO_LONG", "AUDIO_TOO_LARGE")


def test_public_map_never_exposes_voice_notes(reviewer):
    report_id = submit(reviewer, wav_bytes(seconds=1.0)).json()["id"]
    reviewer.post(
        f"/api/reports/{report_id}/location",
        json={"lat": 34.49, "lng": 72.31, "label": "Pir Baba, Buner", "source": "reviewer_pin"},
    )
    assert reviewer.post(f"/api/reports/{report_id}/review", json={"action": "approve"}).status_code == 200
    public = reviewer.get("/api/public/reports").json()["items"]
    assert public and all("audio" not in str(p) and "voice" not in str(p) for p in public)
