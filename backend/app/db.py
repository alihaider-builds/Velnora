"""Database tables (SQLAlchemy Core on SQLite) and engine setup."""

from pathlib import Path

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Engine,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    event,
    inspect,
    text,
)

metadata = MetaData()

reports = Table(
    "reports",
    metadata,
    Column("id", String, primary_key=True),
    Column("reference", String, unique=True, nullable=False),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=False),
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
    Column("intake_notes", JSON, nullable=False, default=list),
    Column("status", String, nullable=False),
    Column("urgency", String, nullable=False),
    Column("urgency_set_by_reviewer", Boolean, nullable=False, default=False),
    Column("merged_into", String),
    Column("reviewer_fields", JSON, nullable=False, default=dict),
)

extractions = Table(
    "extractions",
    metadata,
    Column("report_id", String, primary_key=True),
    Column("status", String, nullable=False),
    Column("model", String),
    Column("attempts", Integer, nullable=False, default=0),
    Column("language", String),
    Column("output", JSON),
    Column("raw_response", Text),
    Column("error", Text),
    Column("completed_at", String),
)

locations = Table(
    "locations",
    metadata,
    Column("report_id", String, primary_key=True),
    Column("suggested_lat", Float),
    Column("suggested_lng", Float),
    Column("suggested_label", String),
    Column("confirmed_lat", Float),
    Column("confirmed_lng", Float),
    Column("confirmed_label", String),
    Column("confirmed_source", String),
    Column("confirmed_at", String),
)

audit_log = Table(
    "audit_log",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("report_id", String, index=True, nullable=False),
    Column("at", String, nullable=False),
    Column("actor", String, nullable=False),
    Column("action", String, nullable=False),
    Column("from_status", String),
    Column("to_status", String),
    Column("details", JSON),
    Column("note", Text),
)

categories = Table(
    "categories",
    metadata,
    Column("key", String, primary_key=True),
    Column("label", String, nullable=False),
    Column("label_ur", String),
    Column("keywords", JSON, nullable=False, default=list),
    Column("builtin", Boolean, nullable=False, default=False),
    Column("active", Boolean, nullable=False, default=True),
    Column("position", Integer, nullable=False, default=0),
    Column("created_at", String, nullable=False),
)

helplines = Table(
    "helplines",
    metadata,
    Column("id", String, primary_key=True),
    Column("number", String, unique=True, nullable=False),  # the number people dial, +92...
    Column("label", String, nullable=False),
    Column("provider_number", String),  # the telephony (Twilio) number calls are forwarded to, if different
    Column("active", Boolean, nullable=False, default=True),
    Column("created_at", String, nullable=False),
)

geocode_cache = Table(
    "geocode_cache",
    metadata,
    Column("query_norm", String, primary_key=True),
    Column("results", JSON, nullable=False),
    Column("fetched_at", String, nullable=False),
)


def make_engine(db_path: Path) -> Engine:
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
    """Tiny forward-only migration: add columns introduced after a database was created."""
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in metadata.sorted_tables:
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing:
                    ddl = col.type.compile(dialect=engine.dialect)
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}'))
