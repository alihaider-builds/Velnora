"""Download approved reports as CSV (spreadsheets) or GeoJSON (maps / GIS).

Two shapes:
- reviewer export: what a relief team needs to act — reference, needs, quantities, place,
  exact confirmed location, urgency and the masked report text. Never the sender's number.
- public export: exactly the privacy-filtered public map data (rounded location, no text).

CSV cells that start with = + - @ are prefixed with ' so a spreadsheet never runs text from a
report as a formula (CSV injection), and the file starts with a UTF-8 BOM so Excel shows Urdu.
"""

import csv
import io
import json

from sqlalchemy import Connection

from app import repo
from app.config import Settings
from app.services import categories

REVIEWER_COLUMNS = [
    "reference", "approved_at", "received_at", "channel", "needs", "quantities", "place",
    "location_label", "lat", "lng", "urgency", "report_text", "is_synthetic",
]
PUBLIC_COLUMNS = ["id", "needs", "area_label", "lat", "lng", "approved_at", "is_synthetic"]


def _quantities(b: repo.Bundle) -> list[dict]:
    corrected = b.corrections.get("quantities")
    if corrected is not None:
        return [{"value": q["value"], "label": q["label"]} for q in corrected]
    return [{"value": q["value"], "label": q["label"]} for q in (b.ai or {}).get("quantities", [])]


def reviewer_rows(conn: Connection) -> list[dict]:
    labels = {c["key"]: c["label"] for c in categories.list_all(conn, include_inactive=True)}
    rows = []
    for b in repo.load_all(conn):
        point = b.confirmed_point()
        if b.report["status"] != "approved" or point is None:
            continue
        r = b.report
        rows.append({
            "reference": r["reference"],
            "approved_at": repo.approved_at(conn, b.id) or r["updated_at"],
            "received_at": r["created_at"],
            "channel": r["channel"],
            "needs": [labels.get(n, n) for n in b.effective_needs()],
            "quantities": _quantities(b),
            "place": b.effective_place(),
            "location_label": (b.location or {}).get("confirmed_label"),
            "lat": point[0],
            "lng": point[1],
            "urgency": r["urgency"],
            "report_text": r["masked_text"],
            "is_synthetic": bool(r["is_synthetic"]),
        })
    rows.sort(key=lambda x: x["approved_at"], reverse=True)
    return rows


def public_rows(conn: Connection, settings: Settings) -> list[dict]:
    rows = [p for p in (repo.build_public(conn, b, settings) for b in repo.load_all(conn)) if p]
    rows.sort(key=lambda x: x["approved_at"], reverse=True)
    return rows


def _cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, list):
        value = "; ".join(f"{v['value']} {v['label']}" if isinstance(v, dict) else str(v) for v in value)
    text = str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def to_csv(rows: list[dict], columns: list[str]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([_cell(row.get(c)) for c in columns])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def to_geojson(rows: list[dict]) -> bytes:
    features = [
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [row["lng"], row["lat"]]},
         "properties": {k: v for k, v in row.items() if k not in ("lat", "lng")}}
        for row in rows
    ]
    return json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False).encode("utf-8")
