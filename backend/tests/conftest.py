"""Shared test setup.

By default every test gets its own temporary SQLite file. To run the same tests on PostgreSQL, set
TEST_DATABASE_URL to a LOCAL throwaway database (the tests empty its tables before each test):
    TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/relieflens_test python -m pytest
"""

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url

from app.auth import hash_password
from app.config import Settings
from app.factory import create_app

PASSWORD = "test-password-123"
DEMO_TEXT = "Buner mein pani ghar mein aa gaya, 5 bachay hain, dawai aur saaf pani chahiye."
_HASH = hash_password(PASSWORD)
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
APP_TABLES = "reports, extractions, locations, audit_log, categories, helplines, geocode_cache"


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
    if TEST_DATABASE_URL:
        base["database_url"] = TEST_DATABASE_URL
    base.update(overrides)
    return Settings(**base)


@pytest.fixture(scope="session")
def postgres_test_db():
    """Migrate the local test database once; None when the tests use SQLite."""
    if not TEST_DATABASE_URL:
        return None
    if make_url(TEST_DATABASE_URL).host not in ("localhost", "127.0.0.1", "::1"):
        pytest.exit("TEST_DATABASE_URL must be a local throwaway database: the tests delete its rows.", 2)
    from app.migrate import apply

    apply(TEST_DATABASE_URL, log=lambda _msg: None)
    return TEST_DATABASE_URL


@pytest.fixture(autouse=True)
def _empty_postgres(postgres_test_db):
    if postgres_test_db:
        import psycopg

        from app.migrate import psycopg_url

        with psycopg.connect(psycopg_url(postgres_test_db)) as conn:
            conn.execute(f"truncate {APP_TABLES} restart identity cascade")


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
