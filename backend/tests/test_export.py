import csv
import io
import json

from tests.conftest import DEMO_TEXT, confirm_location, send


def approve(client, body=DEMO_TEXT, sender="+923001234541", **loc) -> str:
    rid = send(client, body=body, sender=sender)
    confirm_location(client, rid, **loc)
    assert client.post(f"/api/reports/{rid}/review", json={"action": "approve", "urgency": "high"}).status_code == 200
    return rid


def read_csv(resp) -> list[dict]:
    text = resp.content.decode("utf-8")
    assert text.startswith("﻿")  # BOM so Excel shows Urdu
    return list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))


def test_reviewer_csv_has_only_approved_reports_without_phone_numbers(reviewer):
    approve(reviewer)
    send(reviewer, body="Dadu mein khana chahiye, abhi pending hai")  # not approved: excluded
    resp = reviewer.get("/api/reports/export", params={"format": "csv"})
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/csv")
    assert resp.headers["content-disposition"].startswith('attachment; filename="relieflens-approved-')
    rows = read_csv(resp)
    assert len(rows) == 1
    row = rows[0]
    assert row["needs"] == "Medicine; Clean water" and row["quantities"] == "5 children"
    assert row["urgency"] == "high" and row["channel"] == "whatsapp"
    assert row["lat"] == "34.49" and row["location_label"] == "Pir Baba, Buner"
    assert "923001234541" not in resp.text and "Rabta" not in row  # never the sender number


def test_reviewer_geojson(reviewer):
    approve(reviewer)
    data = json.loads(reviewer.get("/api/reports/export", params={"format": "geojson"}).content)
    assert data["type"] == "FeatureCollection" and len(data["features"]) == 1
    f = data["features"][0]
    assert f["geometry"] == {"type": "Point", "coordinates": [72.31, 34.49]}
    assert f["properties"]["needs"] == ["Medicine", "Clean water"]
    assert f["properties"]["quantities"] == [{"value": 5, "label": "children"}]


def test_csv_formulas_are_neutralised(reviewer):
    approve(reviewer, body="=HYPERLINK(\"http://evil\") Buner mein dawai chahiye", sender="+923001111111")
    row = read_csv(reviewer.get("/api/reports/export"))[0]
    assert row["report_text"].startswith("'=")


def test_reviewer_export_needs_sign_in(client):
    assert client.get("/api/reports/export").status_code == 401


def test_public_export_is_privacy_filtered(reviewer):
    approve(reviewer)
    reviewer.post("/api/auth/logout")
    resp = reviewer.get("/api/public/export")
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("application/geo+json")
    f = json.loads(resp.content)["features"][0]
    assert set(f["properties"]) == {"id", "needs", "area_label", "approved_at", "is_synthetic"}
    assert f["geometry"]["coordinates"] == [72.31, 34.49]  # already 2 decimals: rounding keeps it
    rows = read_csv(reviewer.get("/api/public/export", params={"format": "csv"}))
    assert list(rows[0]) == ["id", "needs", "area_label", "lat", "lng", "approved_at", "is_synthetic"]
    assert "dawai" not in resp.text and "Buner mein" not in resp.text
