"""Apply the PostgreSQL / Supabase migrations in backend/migrations/, in order, once each.

    python -m app.migrate            # apply migrations that have not run yet
    python -m app.migrate --status   # list applied and pending migrations (changes nothing)
    python -m app.migrate --check    # test the connection the backend uses (changes nothing)

Migrations connect with MIGRATION_DATABASE_URL (an owner login such as `postgres`), falling back
to DATABASE_URL. The backend itself should run with the limited `relieflens_backend` login.
Each file runs in its own transaction and is recorded in `relieflens_migrations`, so a failed
file leaves nothing half-applied and re-running is safe. Migrations only create and grant;
none of them drop tables or delete rows.
"""

import argparse
import sys
from pathlib import Path

from sqlalchemy.engine import make_url

from app.config import BACKEND_DIR, Settings

MIGRATIONS_DIR = BACKEND_DIR / "migrations"

TRACKING_TABLE = """
create table if not exists public.relieflens_migrations (
    version    text primary key,
    applied_at timestamptz not null default now()
);
alter table public.relieflens_migrations enable row level security;
do $$
declare r text;
begin
    foreach r in array array['anon', 'authenticated'] loop
        if exists (select 1 from pg_roles where rolname = r) then
            execute format('revoke all on table public.relieflens_migrations from %I', r);
        end if;
    end loop;
end
$$;
"""


def psycopg_url(url: str) -> str:
    """A plain libpq URL (psycopg.connect does not understand SQLAlchemy's "+psycopg" driver suffix)."""
    from app.db import postgres_url

    return make_url(postgres_url(url)).set(drivername="postgresql").render_as_string(hide_password=False)


def describe(url: str) -> str:
    """user@host:port/database — never the password."""
    u = make_url(url)
    return f"{u.username}@{u.host}:{u.port or 5432}/{u.database}"


def migration_files(directory: Path = MIGRATIONS_DIR) -> list[Path]:
    return sorted(directory.glob("*.sql"))


def applied_versions(conn) -> set[str]:
    conn.execute(TRACKING_TABLE)
    return {row[0] for row in conn.execute("select version from public.relieflens_migrations")}


def apply(url: str, directory: Path = MIGRATIONS_DIR, log=print) -> list[str]:
    """Apply pending migrations; returns the versions applied now."""
    import psycopg

    done = []
    with psycopg.connect(psycopg_url(url), connect_timeout=15, prepare_threshold=None) as conn:
        with conn.transaction():
            already = applied_versions(conn)
        for path in migration_files(directory):
            version = path.stem
            if version in already:
                continue
            log(f"  applying {path.name} ...")
            with conn.transaction():
                conn.execute(path.read_text(encoding="utf-8"))  # no parameters: several statements allowed
                conn.execute("insert into public.relieflens_migrations (version) values (%s)", (version,))
            done.append(version)
    return done


def status(url: str, directory: Path = MIGRATIONS_DIR) -> list[tuple[str, bool]]:
    import psycopg

    with psycopg.connect(psycopg_url(url), connect_timeout=15) as conn:
        try:
            rows = conn.execute("select version from public.relieflens_migrations").fetchall()
        except psycopg.errors.UndefinedTable:
            rows = []
    applied = {r[0] for r in rows}
    return [(p.stem, p.stem in applied) for p in migration_files(directory)]


def check(settings: Settings) -> str:
    """Connect exactly like the backend does and confirm the tables are there."""
    from sqlalchemy import text

    from app.db import make_engine

    engine = make_engine(settings)  # raises with a clear message if migrations are missing
    with engine.connect() as conn:
        user, version = conn.execute(text("select current_user, current_setting('server_version')")).one()
        count = conn.execute(text("select count(*) from public.reports")).scalar_one()
    engine.dispose()
    return f"Connected as {user} (PostgreSQL {version}). Tables OK. Reports stored: {count}."


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply ReliefLens PostgreSQL / Supabase migrations.")
    parser.add_argument("--status", action="store_true", help="list applied and pending migrations")
    parser.add_argument("--check", action="store_true", help="test the backend's DATABASE_URL connection")
    args = parser.parse_args()
    settings = Settings()

    if args.check:
        if not settings.database_url:
            sys.exit("DATABASE_URL is not set, so the backend uses the local SQLite file. Nothing to check.")
        print(f"Checking {describe(settings.database_url)} ...")
        try:
            print(check(settings))
        except Exception as exc:  # show the reason without a long traceback; the URL is never printed
            sys.exit(f"Connection check failed: {type(exc).__name__}: {exc}")
        return

    url = settings.migration_database_url or settings.database_url
    if not url:
        sys.exit("Set MIGRATION_DATABASE_URL (or DATABASE_URL) in .env first. See docs/SUPABASE_SETUP.md.")
    print(f"Database: {describe(url)}")
    if args.status:
        for version, applied in status(url):
            print(f"  {'applied' if applied else 'PENDING'}  {version}")
        return
    done = apply(url)
    print(f"Applied {len(done)} migration(s)." if done else "Already up to date.")


if __name__ == "__main__":
    main()
