"""Helpline numbers the organizer manages from the dashboard.

A call reaches the backend only through a telephony provider (Twilio). An ordinary mobile
number becomes a helpline by forwarding its calls to the provider number, so each helpline
stores the number people dial and, optionally, the provider number its calls arrive on.
Calls are never rejected for an unknown number; they are recorded with no helpline.
"""

import uuid

from sqlalchemy import Connection, insert, select, update

from app.db import helplines
from app.services.privacy import normalize_phone
from app.timeutil import now_iso


def to_dict(row) -> dict:
    return {"id": row.id, "number": row.number, "label": row.label, "provider_number": row.provider_number,
            "active": bool(row.active), "created_at": row.created_at}


def list_all(conn: Connection, include_inactive: bool = True) -> list[dict]:
    q = select(helplines).order_by(helplines.c.created_at)
    if not include_inactive:
        q = q.where(helplines.c.active.is_(True))
    return [to_dict(r) for r in conn.execute(q)]


def get(conn: Connection, helpline_id: str) -> dict | None:
    row = conn.execute(select(helplines).where(helplines.c.id == helpline_id)).first()
    return to_dict(row) if row else None


def _norm(number: str | None) -> str | None:
    number = (number or "").strip()
    return normalize_phone(number) if number else None


def create(conn: Connection, number: str, label: str, provider_number: str | None) -> dict:
    num = _norm(number)
    if conn.execute(select(helplines.c.id).where(helplines.c.number == num)).first():
        raise ValueError("This helpline number is already added.")
    row = {"id": str(uuid.uuid4()), "number": num, "label": label.strip(),
           "provider_number": _norm(provider_number), "active": True, "created_at": now_iso()}
    conn.execute(insert(helplines).values(**row))
    return row


def patch(conn: Connection, helpline_id: str, changes: dict) -> dict | None:
    if get(conn, helpline_id) is None:
        return None
    values = {}
    if "label" in changes and changes["label"]:
        values["label"] = changes["label"].strip()
    if "provider_number" in changes:
        values["provider_number"] = _norm(changes["provider_number"])
    if "active" in changes and changes["active"] is not None:
        values["active"] = changes["active"]
    if values:
        conn.execute(update(helplines).where(helplines.c.id == helpline_id).values(**values))
    return get(conn, helpline_id)


def match(conn: Connection, *numbers: str | None) -> dict | None:
    """The helpline a call came in on: Twilio's `To` (the provider number, or the helpline itself)
    or `ForwardedFrom` (the mobile that forwarded the call, when the carrier passes it on)."""
    wanted = {n for n in (_norm(x) for x in numbers) if n and len(n) > 6}
    if not wanted:
        return None
    for h in list_all(conn):
        if h["number"] in wanted or (h["provider_number"] and h["provider_number"] in wanted):
            return h
    return None
