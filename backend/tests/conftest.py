import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.config import Settings
from app.factory import create_app

PASSWORD = "test-password-123"
DEMO_TEXT = "Buner mein pani ghar mein aa gaya, 5 bachay hain, dawai aur saaf pani chahiye."
_HASH = hash_password(PASSWORD)


def make_settings(tmp_path, **overrides) -> Settings:
    base = dict(
        _env_file=None,
        database_path=str(tmp_path / "test.db"),
        upload_dir=str(tmp_path / "uploads"),
        llm_backend="fake",
        geocoder_enabled=False,
        reviewer_password_hash=_HASH,
        session_secret="test-secret-" + "x" * 20,
        sender_hash_secret="sender-secret",
        rate_limit_enabled=False,
        twilio_validate_signature=False,
        demo_mode=True,
    )
    base.update(overrides)
    return Settings(**base)


@pytest.fixture
def settings(tmp_path):
    return make_settings(tmp_path)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c


@pytest.fixture
def reviewer(client):
    resp = client.post("/api/auth/login", json={"password": PASSWORD})
    assert resp.status_code == 200
    return client


def send(client, body=DEMO_TEXT, channel="whatsapp", sender="+923001234541") -> str:
    resp = client.post("/api/simulator/send", json={"channel": channel, "from": sender, "body": body})
    assert resp.status_code == 200, resp.text
    return resp.json()["report_id"]


def confirm_location(client, report_id, lat=34.49, lng=72.31, label="Pir Baba, Buner"):
    resp = client.post(f"/api/reports/{report_id}/location",
                       json={"lat": lat, "lng": lng, "label": label, "source": "reviewer_pin"})
    assert resp.status_code == 200, resp.text
    return resp.json()
