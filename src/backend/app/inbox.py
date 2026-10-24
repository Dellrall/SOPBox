"""Teammates, each person's notification inbox, and per-person accountability.

`users` has no row-level security (sign-in reads it before the workspace is known), so every query
on it here filters on `workspace_id` itself.
"""

from collections.abc import Iterable
from datetime import datetime, timezone

import psycopg

from app.models import Accountability, Inbox, Notification, NotificationKind, TeamMember


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def team(conn: psycopg.Connection, ws: int) -> list[TeamMember]:
    rows = conn.execute(
        "SELECT id, username, display_name, role FROM users WHERE workspace_id = %s AND active "
        "ORDER BY lower(display_name)",
        (ws,),
    ).fetchall()
    return [TeamMember(**r) for r in rows]


def members(conn: psycopg.Connection, ws: int, *, ids: Iterable[int] = (), usernames: Iterable[str] = ()) -> dict[int, str]:
    """Active teammates among these ids or usernames, as {id: display name}. Others are left out."""
    rows = conn.execute(
        "SELECT id, display_name FROM users WHERE workspace_id = %s AND active "
        "AND (id = ANY(%s) OR lower(username) = ANY(%s))",
        (ws, list(ids), [u.lower() for u in usernames]),
    ).fetchall()
    return {r["id"]: r["display_name"] for r in rows}


def approver_ids(conn: psycopg.Connection, ws: int) -> list[int]:
    """Everyone who can decide a delivery that is waiting for approval (see auth.can_access_section)."""
    rows = conn.execute(
        "SELECT id FROM users WHERE workspace_id = %s AND active "
        "AND (role IN ('owner', 'manager') OR section_access->>'approvals' = 'edit')",
        (ws,),
    ).fetchall()
    return [r["id"] for r in rows]


def notify(
    conn: psycopg.Connection,
    ws: int,
    user_ids: Iterable[int],
    kind: NotificationKind,
    delivery_id: int | None,
    actor: str,
    body: str,
    *,
    skip: int | None = None,
) -> None:
    """Put a notification in each of these inboxes, never in `skip`'s (the person who acted)."""
    for user_id in sorted(set(user_ids) - {skip}):
        conn.execute(
            "INSERT INTO notifications (workspace_id, user_id, kind, delivery_id, actor, body, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (ws, user_id, kind, delivery_id, actor, body[:500], _now()),
        )


def inbox(conn: psycopg.Connection, ws: int, user_id: int, limit: int = 30) -> Inbox:
    rows = conn.execute(
        "SELECT id, kind, delivery_id, actor, body, created_at, read_at IS NOT NULL AS read "
        "FROM notifications WHERE workspace_id = %s AND user_id = %s ORDER BY id DESC LIMIT %s",
        (ws, user_id, limit),
    ).fetchall()
    unread = conn.execute(
        "SELECT count(*) AS n FROM notifications WHERE workspace_id = %s AND user_id = %s AND read_at IS NULL",
        (ws, user_id),
    ).fetchone()["n"]
    return Inbox(unread=unread, items=[Notification(**r) for r in rows])


def mark_read(conn: psycopg.Connection, ws: int, user_id: int, ids: list[int] | None) -> None:
    """Mark these notifications read, or all of them. Only ever the caller's own."""
    conn.execute(
        "UPDATE notifications SET read_at = %s WHERE workspace_id = %s AND user_id = %s "
        "AND read_at IS NULL AND (%s::bigint[] IS NULL OR id = ANY(%s::bigint[]))",
        (_now(), ws, user_id, ids, ids),
    )


_DECIDED = "('delivery.accepted', 'delivery.rejected', 'delivery.returned', 'delivery.partly_accepted')"


def accountability(conn: psycopg.Connection, ws: int) -> list[Accountability]:
    """Each person's counts, from the audit log by account, so a renamed person keeps their record."""
    rows = conn.execute(
        f"""
        SELECT u.id AS user_id, u.username, u.display_name, u.role, u.active,
            count(a.id) FILTER (WHERE a.action = 'delivery.received') AS received,
            count(a.id) FILTER (WHERE a.action IN {_DECIDED}) AS decided,
            count(a.id) FILTER (WHERE a.action = 'stocktake.created') AS stock_counts,
            count(a.id) FILTER (WHERE a.action LIKE 'po.%%') AS purchase_orders,
            count(a.id) FILTER (WHERE a.action = 'delivery.photo_comment') AS comments,
            (SELECT count(*) FROM delivery_tags t WHERE t.user_id = u.id) AS tagged,
            max(a.at) AS last_active,
            (SELECT max(s.at) FROM sign_ins s WHERE s.user_id = u.id) AS last_sign_in
        FROM users u LEFT JOIN audit_log a ON a.actor_id = u.id AND a.workspace_id = u.workspace_id
        WHERE u.workspace_id = %s
        GROUP BY u.id
        ORDER BY u.role <> 'owner', lower(u.display_name)
        """,
        (ws,),
    ).fetchall()
    return [Accountability(**r) for r in rows]
