"""PostgreSQL / Supabase-only checks. Skipped unless TEST_DATABASE_URL points at a local test database."""

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Integer, inspect
from sqlalchemy.engine import make_url

from app.db import IsoTimestamp, check_schema, make_engine, metadata
from app.factory import create_app
from app.migrate import apply, migration_files, psycopg_url
from tests.conftest import PASSWORD, TEST_DATABASE_URL, confirm_location, make_settings, send

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="set TEST_DATABASE_URL to run PostgreSQL tests")


def pg(postgres_test_db):
    return psycopg.connect(psycopg_url(postgres_test_db))


def test_migrations_are_recorded_and_safe_to_rerun(postgres_test_db):
    assert apply(postgres_test_db, log=lambda _m: None) == []  # nothing pending, nothing re-run
    with pg(postgres_test_db) as conn:
        applied = {r[0] for r in conn.execute("select version from relieflens_migrations")}
    assert applied == {p.stem for p in migration_files()}


def test_schema_matches_the_backend_tables(postgres_test_db, tmp_path):
    engine = make_engine(make_settings(tmp_path))
    insp = inspect(engine)
    for table in metadata.sorted_tables:
        cols = {c["name"]: c for c in insp.get_columns(table.name)}
        assert set(cols) == {c.name for c in table.columns}, table.name
        for col in table.columns:
            db_col = cols[col.name]
            assert db_col["nullable"] == col.nullable, f"{table.name}.{col.name}"
            pg_type = str(db_col["type"])
            if isinstance(col.type, IsoTimestamp):
                assert pg_type == "TIMESTAMP", f"{table.name}.{col.name}"
                assert db_col["type"].timezone
            elif isinstance(col.type, Integer):
                assert pg_type in ("INTEGER", "BIGINT")
            elif col.type.__class__.__name__ == "JSON":
                assert pg_type == "JSONB", f"{table.name}.{col.name}"
    engine.dispose()


def test_rls_and_privileges_hide_every_table_from_the_public_api(postgres_test_db, reviewer):
    send(reviewer)
    with pg(postgres_test_db) as conn:
        for table in [t.name for t in metadata.sorted_tables] + ["relieflens_migrations"]:
            assert conn.execute("select relrowsecurity from pg_class where oid = %s::regclass",
                                (f"public.{table}",)).fetchone()[0], table
            for role in ("anon", "authenticated"):
                assert not conn.execute("select has_table_privilege(%s, %s, 'select')",
                                        (role, f"public.{table}")).fetchone()[0], (role, table)
        # Even if someone later grants the anon key access by mistake, RLS (no policy) returns no rows.
        with conn.transaction(force_rollback=True):
            conn.execute("grant select on public.reports to anon")
            conn.execute("set local role anon")
            assert conn.execute("select count(*) from public.reports").fetchone()[0] == 0


def test_backend_role_can_use_the_app_tables_but_nothing_more(postgres_test_db):
    with pg(postgres_test_db) as conn:
        with conn.transaction(force_rollback=True):
            conn.execute("set local role relieflens_backend")
            conn.execute("insert into reports (id, reference, channel, source_text, masked_text) "
                         "values ('11111111-1111-1111-1111-111111111111', 'RL-TEST', 'web', 'x', 'x')")
            assert conn.execute("select count(*) from reports").fetchone()[0] == 1
            conn.execute("delete from reports where reference = 'RL-TEST'")
        for forbidden in ("create table evil (id int)",
                          "update audit_log set note = 'rewritten'",
                          "delete from categories",
                          "alter table reports disable row level security",
                          "drop table geocode_cache"):
            with pytest.raises(psycopg.Error), conn.transaction(force_rollback=True):
                conn.execute("set local role relieflens_backend")
                conn.execute(forbidden)


def test_constraints_reject_invalid_values(postgres_test_db):
    insert = ("insert into reports (id, reference, channel, source_text, masked_text, status, submitted_lat) "
              "values (%s, %s, %s, 'x', 'x', %s, %s)")
    bad_rows = [
        ("a", "RL-A", "web", "published", None),  # unknown status
        ("b", "RL-B", "fax", "pending_review", None),  # unknown channel
        ("c", "RL-C", "web", "pending_review", 33.0),  # latitude without longitude
    ]
    with pg(postgres_test_db) as conn:
        for row in bad_rows:
            with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
                conn.execute(insert, row)


def test_deleting_a_report_deletes_its_parts(postgres_test_db, reviewer):
    rid = send(reviewer)
    confirm_location(reviewer, rid)
    assert reviewer.delete(f"/api/reports/{rid}").status_code == 204
    with pg(postgres_test_db) as conn:
        for table in ("reports", "extractions", "locations"):
            key = "id" if table == "reports" else "report_id"
            assert conn.execute(f"select count(*) from {table} where {key} = %s", (rid,)).fetchone()[0] == 0


def test_timestamps_are_timestamptz_but_the_api_keeps_iso_strings(postgres_test_db, reviewer):
    rid = send(reviewer)
    body = reviewer.get(f"/api/reports/{rid}").json()
    assert body["created_at"].endswith("Z") and body["audit"][0]["at"].endswith("Z")
    with pg(postgres_test_db) as conn:
        assert conn.execute("select pg_typeof(created_at)::text from reports").fetchone()[0] == \
            "timestamp with time zone"


def test_whole_workflow_runs_as_the_limited_backend_login(postgres_test_db, tmp_path):
    """Submit -> confirm location -> approve -> export, with the least-privilege role, not the owner."""
    with psycopg.connect(psycopg_url(postgres_test_db), autocommit=True) as conn:
        conn.execute("alter role relieflens_backend with login password 'local-test-only'")
    try:
        url = make_url(postgres_test_db).set(username="relieflens_backend", password="local-test-only")
        settings = make_settings(tmp_path, database_url=url.render_as_string(hide_password=False))
        with TestClient(create_app(settings)) as c:
            assert c.post("/api/auth/login", json={"password": PASSWORD}).status_code == 200
            rid = send(c)
            confirm_location(c, rid)
            assert c.post(f"/api/reports/{rid}/review", json={"action": "approve"}).status_code == 200
            assert c.get("/api/reports/export").content.decode("utf-8").count("\r\n") == 2  # header + 1 row
            assert c.get("/api/public/reports").json()["total"] == 1
            assert c.app.state.engine.dialect.name == "postgresql"
    finally:
        with psycopg.connect(psycopg_url(postgres_test_db), autocommit=True) as conn:
            conn.execute("alter role relieflens_backend with nologin password null")


def test_startup_explains_missing_migrations(postgres_test_db):
    admin = make_url(postgres_test_db)
    with psycopg.connect(psycopg_url(postgres_test_db), autocommit=True) as conn:
        conn.execute("drop database if exists relieflens_empty_check")
        conn.execute("create database relieflens_empty_check")
    try:
        from sqlalchemy import create_engine

        engine = create_engine(admin.set(drivername="postgresql+psycopg", database="relieflens_empty_check"))
        with pytest.raises(RuntimeError, match="python -m app.migrate"):
            check_schema(engine)
        engine.dispose()
    finally:
        with psycopg.connect(psycopg_url(postgres_test_db), autocommit=True) as conn:
            conn.execute("drop database if exists relieflens_empty_check")
