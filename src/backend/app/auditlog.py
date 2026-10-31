"""The workspace's audit log: who did what, and when. Written in the same transaction as the change.

`actor` is the name shown in the log. `actor_id` is the signed-in account (set on the connection by
auth.current_user), so a person's actions still count as theirs after they change their name.
"""

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
        "INSERT INTO audit_log (workspace_id, at, actor, action, delivery_id, detail, actor_id, outlet_id) "
        "VALUES (%s, %s, %s, %s, %s, %s, "
        "CASE WHEN %s THEN NULL ELSE NULLIF(current_setting('app.user_id', true), '')::bigint END, "
        # The outlet worked in; else, for a delivery, the outlet it arrived at; else the whole workspace.
        "COALESCE(NULLIF(current_setting('app.outlet_id', true), '')::bigint, "
        "(SELECT s.outlet_id FROM deliveries d JOIN storages s ON s.id = d.storage_id WHERE d.id = %s)))",
        (ws, _now(), actor, action, delivery_id, detail, actor == "system", delivery_id),
    )
