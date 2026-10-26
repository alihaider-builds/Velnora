"""Load the 30 synthetic sample reports into the database.

    python -m app.seed            # add samples (skips if samples already exist)
    python -m app.seed --reset    # delete the local SQLite file first

Demo data only: it refuses to run unless DEMO_MODE=true, and --reset never touches a
PostgreSQL/Supabase database (DATABASE_URL). Nothing runs this automatically.

Extraction uses the configured model (LLM_BACKEND). Locations use each sample's
labelled target point (no network calls), and a few reports are approved so the
public map and dashboard are not empty. All seeded data is synthetic.
"""

import argparse
import asyncio
import json
from datetime import timedelta

from sqlalchemy import insert, select, update

from app.config import REPO_DIR, Settings
from app.db import locations, make_engine, reports
from app.services import audit
from app.services.categories import ensure_builtins
from app.services.channels import create_report
from app.services.jobs import run_extraction
from app.services.llm import build_llm_client
from app.timeutil import now_iso, to_iso, utcnow

SAMPLES = REPO_DIR / "data" / "samples" / "reports.jsonl"
APPROVE = {"S06", "S09", "S10", "S23", "S25", "S30"}
FLAG = {"S26"}


def load_samples() -> list[dict]:
    with SAMPLES.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


class SeedRefused(Exception):
    pass


async def seed(settings: Settings, reset: bool = False) -> int:
    if not settings.demo_mode:
        raise SeedRefused("DEMO_MODE is false: synthetic reports are never loaded into a production database.")
    if reset and settings.database_url:
        raise SeedRefused("--reset only deletes a local SQLite file. It never deletes a PostgreSQL/Supabase database.")
    db_path = settings.resolve(settings.database_path)
    if reset and db_path.exists():
        db_path.unlink()
        for suffix in ("-wal", "-shm"):
            db_path.with_name(db_path.name + suffix).unlink(missing_ok=True)
    engine = make_engine(settings)
    ensure_builtins(engine)
    with engine.connect() as conn:
        if conn.execute(select(reports.c.id).where(reports.c.provider_message_id.like("seed-%"))).first():
            print("Samples already loaded. Use --reset to start over.")
            return 0

    llm = build_llm_client(settings)
    now = utcnow()
    count = 0
    for s in load_samples():
        created = create_report(
            engine, settings, channel=s["channel"], text=s["text"], sender=s.get("from"),
            place_text=s.get("place_text"), provider_message_id=f"seed-{s['id']}", is_synthetic=True,
            created_at=to_iso(now + timedelta(hours=s["created_offset_hours"])),
        )
        await run_extraction(created.report_id, engine, settings, llm, geocoder=None)
        target = s["labels"].get("target_point")
        place = s["labels"].get("place_name")
        with engine.begin() as conn:
            if target:
                conn.execute(insert(locations).values(
                    report_id=created.report_id, suggested_lat=target["lat"], suggested_lng=target["lng"],
                    suggested_label=place,
                ))
            if s["id"] in APPROVE and target:
                conn.execute(update(locations).where(locations.c.report_id == created.report_id).values(
                    confirmed_lat=target["lat"], confirmed_lng=target["lng"], confirmed_label=place,
                    confirmed_source="geocoder_candidate", confirmed_at=now_iso(),
                ))
                conn.execute(update(reports).where(reports.c.id == created.report_id).values(status="approved"))
                audit.record(conn, created.report_id, "approve", actor="seed", from_status="pending_review",
                             to_status="approved", note="Seeded demo data")
            elif s["id"] in FLAG:
                conn.execute(update(reports).where(reports.c.id == created.report_id).values(status="flagged"))
                audit.record(conn, created.report_id, "flag", actor="seed", from_status="pending_review",
                             to_status="flagged", note="Seeded demo data")
        count += 1
        print(f"  {s['id']} -> {created.reference}")
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Load synthetic sample reports.")
    parser.add_argument("--reset", action="store_true", help="delete the local SQLite file first")
    args = parser.parse_args()
    settings = Settings()
    print(f"Seeding with model backend: {settings.llm_backend} ({settings.model_name})")
    try:
        n = asyncio.run(seed(settings, reset=args.reset))
    except SeedRefused as exc:
        raise SystemExit(f"Not seeding: {exc}") from None
    print(f"Loaded {n} synthetic reports.")


if __name__ == "__main__":
    main()
