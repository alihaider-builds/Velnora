import asyncio
import csv
import io
import json

import pytest

from app.db import postgres_url
from app.migrate import describe
from app.seed import SeedRefused, seed
from tests.conftest import confirm_location, make_settings, send


def test_postgres_url_uses_psycopg_and_tls_for_remote_hosts():
    url = postgres_url("postgresql://relieflens_backend.abc:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres")
    assert url.startswith("postgresql+psycopg://") and url.endswith("?sslmode=require")
    assert "sslmode" not in postgres_url("postgres://postgres@127.0.0.1:5432/test")
    assert postgres_url("postgresql://u:p@db.example.com/x?sslmode=verify-full").endswith("sslmode=verify-full")


def test_describe_never_shows_the_password():
    text = describe("postgresql://postgres.abc:sup3r-secret@pooler.supabase.com:5432/postgres")
    assert text == "postgres.abc@pooler.supabase.com:5432/postgres" and "sup3r" not in text


def test_seed_refuses_outside_demo_mode(tmp_path):
    with pytest.raises(SeedRefused, match="DEMO_MODE"):
        asyncio.run(seed(make_settings(tmp_path, demo_mode=False)))
    assert not (tmp_path / "test.db").exists()  # refused before the database was even opened


def test_seed_reset_never_touches_a_postgres_database(tmp_path):
    settings = make_settings(tmp_path, database_url="postgresql://postgres@127.0.0.1:1/never-used")
    with pytest.raises(SeedRefused, match="never deletes"):
        asyncio.run(seed(settings, reset=True))  # refused before any connection is made


def _review(client, rid, action):
    resp = client.post(f"/api/reports/{rid}/review", json={"action": action})
    assert resp.status_code == 200, resp.text


def _csv(resp) -> list[dict]:
    return list(csv.DictReader(io.StringIO(resp.content.decode("utf-8").lstrip("﻿"))))


def test_exports_include_only_approved_reports(reviewer):
    approved = send(reviewer, body="Buner mein dawai chahiye, 5 bachay", sender="+923001000001")
    rejected = send(reviewer, body="Swat mein khana chahiye, 20 log", sender="+923001000002")
    flagged = send(reviewer, body="Dadu mein pani chahiye, 3 ghar", sender="+923001000003")
    send(reviewer, body="Thatta mein shelter chahiye, pending", sender="+923001000004")  # stays pending
    for rid in (approved, rejected, flagged):
        confirm_location(reviewer, rid)
    _review(reviewer, approved, "approve")
    _review(reviewer, rejected, "reject")
    _review(reviewer, flagged, "flag")
    reference = reviewer.get(f"/api/reports/{approved}").json()["reference"]

    rows = _csv(reviewer.get("/api/reports/export"))
    assert [r["reference"] for r in rows] == [reference]
    assert rows[0]["approved_at"].endswith("Z")
    geo = json.loads(reviewer.get("/api/reports/export", params={"format": "geojson"}).content)
    assert [f["properties"]["reference"] for f in geo["features"]] == [reference]
    public = reviewer.get("/api/public/reports").json()
    assert [p["id"] for p in public["items"]] == [approved]
    assert [r["id"] for r in _csv(reviewer.get("/api/public/export", params={"format": "csv"}))] == [approved]

    _review(reviewer, approved, "reopen")  # back to pending: leaves every export
    assert _csv(reviewer.get("/api/reports/export")) == []
    assert reviewer.get("/api/public/reports").json() == {"items": [], "total": 0}


def test_empty_database_exports_are_valid_and_empty(reviewer):
    resp = reviewer.get("/api/reports/export")
    assert resp.status_code == 200 and _csv(resp) == []
    assert resp.content.decode("utf-8").lstrip("﻿").startswith("reference,approved_at")
    geo = json.loads(reviewer.get("/api/reports/export", params={"format": "geojson"}).content)
    assert geo == {"type": "FeatureCollection", "features": []}
    assert reviewer.get("/api/public/stats").json()["total_approved"] == 0


def test_only_the_signed_in_reviewer_can_change_approval(client):
    rid = send(client)
    assert client.post(f"/api/reports/{rid}/review", json={"action": "approve"}).status_code == 401
    assert client.post(f"/api/reports/{rid}/location",
                       json={"lat": 34.49, "lng": 72.31, "source": "reviewer_pin"}).status_code == 401
    assert client.get("/api/reports/export").status_code == 401
    assert client.get("/api/public/reports").json()["total"] == 0


def test_unknown_review_action_and_bad_report_id_are_rejected(reviewer):
    rid = send(reviewer)
    assert reviewer.post(f"/api/reports/{rid}/review", json={"action": "publish"}).status_code == 400
    assert reviewer.get("/api/reports/not-a-real-id").status_code == 404
