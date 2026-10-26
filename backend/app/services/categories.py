"""Help categories: six built-ins plus categories the organizer adds from the dashboard.

The AI may only use active categories. Keywords help the offline fallback and are
given to Gemma as hints; they are optional.
"""

import hashlib
import re

from sqlalchemy import Connection, Engine, insert, select, update

from app.db import categories
from app.timeutil import now_iso

BUILTINS: list[dict] = [
    {"key": "food", "label": "Food", "label_ur": "خوراک"},
    {"key": "clean_water", "label": "Clean water", "label_ur": "صاف پانی"},
    {"key": "shelter", "label": "Shelter", "label_ur": "پناہ"},
    {"key": "medicine", "label": "Medicine", "label_ur": "دوا"},
    {"key": "evacuation", "label": "Evacuation", "label_ur": "انخلا"},
    {"key": "other", "label": "Other", "label_ur": "دیگر"},
]
UNDEACTIVATABLE = {"other"}


def ensure_builtins(engine: Engine) -> None:
    with engine.begin() as conn:
        existing = {r.key for r in conn.execute(select(categories.c.key))}
        for pos, cat in enumerate(BUILTINS):
            if cat["key"] not in existing:
                conn.execute(insert(categories).values(
                    **cat, keywords=[], builtin=True, active=True, position=pos, created_at=now_iso()))


def to_dict(row) -> dict:
    return {
        "key": row.key, "label": row.label, "label_ur": row.label_ur, "keywords": list(row.keywords or []),
        "builtin": bool(row.builtin), "active": bool(row.active), "created_at": row.created_at,
    }


def list_all(conn: Connection, include_inactive: bool = False) -> list[dict]:
    q = select(categories).order_by(categories.c.position, categories.c.created_at)
    if not include_inactive:
        q = q.where(categories.c.active.is_(True))
    return [to_dict(r) for r in conn.execute(q)]


def active(conn: Connection) -> list[dict]:
    return list_all(conn, include_inactive=False)


def all_keys(conn: Connection) -> set[str]:
    return {r.key for r in conn.execute(select(categories.c.key))}


def make_key(label: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:28]
    if not base:  # e.g. a label written only in Urdu
        base = "cat_" + hashlib.sha1(label.encode()).hexdigest()[:6]
    key, n = base, 2
    while key in taken:
        key = f"{base}_{n}"
        n += 1
    return key


def clean_keywords(words: list[str] | None) -> list[str]:
    seen, out = set(), []
    for w in words or []:
        w = " ".join(w.split())[:40]
        if w and w.lower() not in seen:
            seen.add(w.lower())
            out.append(w)
    return out[:20]


def create(conn: Connection, label: str, label_ur: str | None, keywords: list[str] | None) -> dict:
    keys = all_keys(conn)
    labels = {r.label.lower() for r in conn.execute(select(categories.c.label))}
    if label.strip().lower() in labels:
        raise ValueError("A category with this name already exists.")
    key = make_key(label, keys)
    pos = len(keys)
    conn.execute(insert(categories).values(
        key=key, label=label.strip(), label_ur=(label_ur or "").strip() or None, keywords=clean_keywords(keywords),
        builtin=False, active=True, position=pos, created_at=now_iso()))
    return to_dict(conn.execute(select(categories).where(categories.c.key == key)).one())


def patch(conn: Connection, key: str, changes: dict) -> dict | None:
    row = conn.execute(select(categories).where(categories.c.key == key)).first()
    if row is None:
        return None
    values = {}
    if "label" in changes and changes["label"]:
        values["label"] = changes["label"].strip()
    if "label_ur" in changes:
        values["label_ur"] = (changes["label_ur"] or "").strip() or None
    if "keywords" in changes:
        values["keywords"] = clean_keywords(changes["keywords"])
    if "active" in changes and changes["active"] is not None:
        if not changes["active"] and key in UNDEACTIVATABLE:
            raise ValueError("The 'Other' category can't be turned off.")
        values["active"] = bool(changes["active"])
    if values:
        conn.execute(update(categories).where(categories.c.key == key).values(**values))
    return to_dict(conn.execute(select(categories).where(categories.c.key == key)).one())
