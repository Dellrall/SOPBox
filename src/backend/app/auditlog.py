"""The workspace's audit log: who did what, and when. Written in the same transaction as the change."""

from datetime import datetime, timezone

import psycopg


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def audit(
    conn: psycopg.Connection,
    ws: int,
    actor: str,
    action: str,
    delivery_id: int | None,
    detail: str = "",
) -> None:
    conn.execute(
        "INSERT INTO audit_log (workspace_id, at, actor, action, delivery_id, detail) "
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (ws, _now(), actor, action, delivery_id, detail),
    )
