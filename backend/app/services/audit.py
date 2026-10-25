from sqlalchemy import Connection, insert

from app.db import audit_log
from app.timeutil import now_iso


def record(
    conn: Connection,
    report_id: str,
    action: str,
    *,
    actor: str = "reviewer",
    from_status: str | None = None,
    to_status: str | None = None,
    details: dict | None = None,
    note: str | None = None,
) -> None:
    conn.execute(
        insert(audit_log).values(
            report_id=report_id,
            at=now_iso(),
            actor=actor,
            action=action,
            from_status=from_status,
            to_status=to_status,
            details=details or {},
            note=note,
        )
    )
