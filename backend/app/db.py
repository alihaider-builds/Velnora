"""Database tables (SQLAlchemy Core) and engine setup.

Two databases are supported with the same tables and column names:
- SQLite (default, `DATABASE_PATH`): a local file, created automatically. Good for development and demos.
- PostgreSQL / Supabase (`DATABASE_URL`): created by the SQL migrations in `backend/migrations/`
  (`python -m app.migrate`). The app never creates or alters Postgres tables on its own.

Timestamps are ISO 8601 "Z" strings everywhere in Python; Postgres stores them as `timestamptz`.
"""

from datetime import datetime
from pathlib import Path

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Engine,
    Float,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    TypeDecorator,
    create_engine,
    event,
    inspect,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import make_url

from app.timeutil import parse_iso, to_iso


class IsoTimestamp(TypeDecorator):
    """ISO 8601 "Z" strings in Python; `timestamptz` in Postgres, text in SQLite (existing files keep working)."""

    impl = String
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(DateTime(timezone=True))
        return dialect.type_descriptor(String())

    def process_bind_param(self, value, dialect):
        if dialect.name == "postgresql" and isinstance(value, str):
            return parse_iso(value)
        return value

    def process_result_value(self, value, dialect):
        if isinstance(value, datetime):
            return to_iso(value)
        return value


Json = JSON().with_variant(JSONB(), "postgresql")

REPORT_STATUSES = ("pending_review", "approved", "rejected", "flagged", "merged")
URGENCIES = ("low", "medium", "high", "unknown")
CHANNELS = ("web", "sms", "whatsapp", "call")
TRANSCRIPT_STATUSES = ("pending", "running", "succeeded", "failed", "manual")
EXTRACTION_STATUSES = ("pending", "running", "succeeded", "failed")
LOCATION_SOURCES = ("submitter_pin", "geocoder_candidate", "reviewer_pin")


def _one_of(column: str, values: tuple[str, ...], nullable: bool = False) -> str:
    allowed = ", ".join(f"'{v}'" for v in values)
    return f"{column} IS NULL OR {column} IN ({allowed})" if nullable else f"{column} IN ({allowed})"


metadata = MetaData()

reports = Table(
    "reports",
    metadata,
    Column("id", String, primary_key=True),
    Column("reference", String, unique=True, nullable=False),
    Column("created_at", IsoTimestamp, nullable=False, index=True),
    Column("updated_at", IsoTimestamp, nullable=False),
    Column("is_synthetic", Boolean, nullable=False, default=True),
    Column("channel", String, nullable=False),
    Column("sender_contact", String),
    Column("sender_hash", String, index=True),
    Column("provider_message_id", String, unique=True),
    Column("source_text", Text, nullable=False),
    Column("masked_text", Text, nullable=False),
    Column("submitted_place_text", String),
    Column("submitted_lat", Float),
    Column("submitted_lng", Float),
    Column("image_path", String),
    Column("audio_path", String),
    Column("call_duration_seconds", Float),
    Column("transcript_status", String),  # None for non-call reports; pending|running|succeeded|failed|manual
    Column("transcript_model", String),
    Column("transcript_error", Text),
    Column("helpline_number", String),  # which helpline the call came in on (snapshot at call time)
    Column("helpline_label", String),
    Column("intake_notes", Json, nullable=False, default=list),
    Column("status", String, nullable=False, index=True),
    Column("urgency", String, nullable=False),
    Column("urgency_set_by_reviewer", Boolean, nullable=False, default=False),
    Column("merged_into", String, ForeignKey("reports.id", ondelete="SET NULL"), index=True),
    Column("reviewer_fields", Json, nullable=False, default=dict),
    CheckConstraint(_one_of("status", REPORT_STATUSES), name="reports_status_check"),
    CheckConstraint(_one_of("urgency", URGENCIES), name="reports_urgency_check"),
    CheckConstraint(_one_of("channel", CHANNELS), name="reports_channel_check"),
    CheckConstraint(_one_of("transcript_status", TRANSCRIPT_STATUSES, nullable=True),
                    name="reports_transcript_status_check"),
)

extractions = Table(
    "extractions",
    metadata,
    Column("report_id", String, ForeignKey("reports.id", ondelete="CASCADE"), primary_key=True),
    Column("status", String, nullable=False),
    Column("model", String),
    Column("attempts", Integer, nullable=False, default=0),
    Column("language", String),
    Column("output", Json),
    Column("raw_response", Text),
    Column("error", Text),
    Column("completed_at", IsoTimestamp),
    CheckConstraint(_one_of("status", EXTRACTION_STATUSES), name="extractions_status_check"),
)

locations = Table(
    "locations",
    metadata,
    Column("report_id", String, ForeignKey("reports.id", ondelete="CASCADE"), primary_key=True),
    Column("suggested_lat", Float),
    Column("suggested_lng", Float),
    Column("suggested_label", String),
    Column("confirmed_lat", Float),
    Column("confirmed_lng", Float),
    Column("confirmed_label", String),
    Column("confirmed_source", String),
    Column("confirmed_at", IsoTimestamp),
    CheckConstraint(_one_of("confirmed_source", LOCATION_SOURCES, nullable=True),
                    name="locations_confirmed_source_check"),
)

# No foreign key on report_id: the audit trail outlives deleted reports, and export events use "export".
audit_log = Table(
    "audit_log",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("report_id", String, index=True, nullable=False),
    Column("at", IsoTimestamp, nullable=False),
    Column("actor", String, nullable=False),
    Column("action", String, nullable=False),
    Column("from_status", String),
    Column("to_status", String),
    Column("details", Json),
    Column("note", Text),
)

categories = Table(
    "categories",
    metadata,
    Column("key", String, primary_key=True),
    Column("label", String, nullable=False),
    Column("label_ur", String),
    Column("keywords", Json, nullable=False, default=list),
    Column("builtin", Boolean, nullable=False, default=False),
    Column("active", Boolean, nullable=False, default=True),
    Column("position", Integer, nullable=False, default=0),
    Column("created_at", IsoTimestamp, nullable=False),
)

helplines = Table(
    "helplines",
    metadata,
    Column("id", String, primary_key=True),
    Column("number", String, unique=True, nullable=False),  # the number people dial, +92...
    Column("label", String, nullable=False),
    Column("provider_number", String),  # the telephony (Twilio) number calls are forwarded to, if different
    Column("active", Boolean, nullable=False, default=True),
    Column("created_at", IsoTimestamp, nullable=False),
)

geocode_cache = Table(
    "geocode_cache",
    metadata,
    Column("query_norm", String, primary_key=True),
    Column("results", Json, nullable=False),
    Column("fetched_at", IsoTimestamp, nullable=False),
)


def postgres_url(url: str) -> str:
    """Use the psycopg 3 driver and require TLS for any non-local host (Supabase accepts TLS)."""
    u = make_url(url)
    if u.drivername in ("postgres", "postgresql"):
        u = u.set(drivername="postgresql+psycopg")
    if u.host not in (None, "localhost", "127.0.0.1", "::1") and "sslmode" not in u.query:
        u = u.update_query_dict({"sslmode": "require"})
    return u.render_as_string(hide_password=False)


def make_engine(settings) -> Engine:
    if settings.database_url:
        return _postgres_engine(settings.database_url)
    return _sqlite_engine(settings.resolve(settings.database_path))


def _postgres_engine(url: str) -> Engine:
    engine = create_engine(
        postgres_url(url),
        pool_pre_ping=True,  # survive the pooler closing idle connections
        pool_size=5,
        max_overflow=5,
        pool_recycle=300,
        # prepare_threshold=None: no server-side prepared statements, so Supabase's transaction pooler works too
        connect_args={"connect_timeout": 10, "prepare_threshold": None},
    )
    check_schema(engine)
    return engine


def check_schema(engine: Engine) -> None:
    """Fail at startup with a clear message when the migrations have not been applied."""
    insp = inspect(engine)
    missing = []
    for table in metadata.sorted_tables:
        if not insp.has_table(table.name):
            missing.append(table.name)
            continue
        existing = {c["name"] for c in insp.get_columns(table.name)}
        missing += [f"{table.name}.{c.name}" for c in table.columns if c.name not in existing]
    if missing:
        raise RuntimeError(
            "The database is missing ReliefLens tables or columns (" + ", ".join(missing[:8])
            + "). Apply the migrations first: cd backend && python -m app.migrate"
        )


def _sqlite_engine(db_path: Path) -> Engine:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()

    metadata.create_all(engine)
    _add_missing_columns(engine)
    return engine


def _add_missing_columns(engine: Engine) -> None:
    """Tiny forward-only migration for SQLite files: add columns introduced after a database was created."""
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in metadata.sorted_tables:
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing:
                    ddl = col.type.compile(dialect=engine.dialect)
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}'))


def upsert(conn, table: Table, values: dict, key: str) -> None:
    """Insert a row, or replace it when `key` already exists (SQLite and Postgres)."""
    if conn.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    stmt = insert(table).values(**values)
    conn.execute(stmt.on_conflict_do_update(index_elements=[key],
                                            set_={k: stmt.excluded[k] for k in values if k != key}))
