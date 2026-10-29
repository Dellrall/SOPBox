"""Closing a business. The owner closes it; for GRACE_DAYS it is read-only (auth.refuse_if_closed):
people can still sign in, look and download their data, and the owner can reopen it. Then it is
deleted for good, with everything in it. Only a small record stays in closed_workspaces: the id,
name and dates, so support can answer "what happened to my workspace?". Ids are never reused."""

import psycopg

from app import inbox
from app.auditlog import audit
from app.auth import CurrentUser
from app.errors import ConflictError, InvalidRequestError
from app.models import ClosingOut

GRACE_DAYS = 30


def state(conn: psycopg.Connection, ws: int) -> ClosingOut:
    row = conn.execute(
        "SELECT to_char(closing_at, 'YYYY-MM-DD\"T\"HH24:MI:SSOF') AS closed_at, "
        "to_char(closing_at + %s * interval '1 day', 'YYYY-MM-DD') AS delete_on FROM workspaces WHERE id = %s",
        (GRACE_DAYS, ws),
    ).fetchone()
    return ClosingOut(closed_at=row["closed_at"], delete_on=row["delete_on"])


def _everyone(conn: psycopg.Connection, ws: int) -> list[int]:
    return [r["id"] for r in conn.execute("SELECT id FROM users WHERE workspace_id = %s AND active", (ws,))]


def close(conn: psycopg.Connection, owner: CurrentUser, workspace_name: str) -> ClosingOut:
    if workspace_name.strip() != owner.workspace_name:
        raise InvalidRequestError("type the workspace's name exactly to close it")
    row = conn.execute(
        "UPDATE workspaces SET closing_at = now(), closed_by = %s WHERE id = %s AND closing_at IS NULL RETURNING id",
        (owner.username, owner.workspace_id),
    ).fetchone()
    if row is None:
        raise ConflictError("this business is already closed")
    out = state(conn, owner.workspace_id)
    audit(conn, owner.workspace_id, owner.display_name, "workspace.closed", None, f"deleted on {out.delete_on}")
    inbox.notify(
        conn, owner.workspace_id, _everyone(conn, owner.workspace_id), "security", None, owner.display_name,
        f"{owner.display_name} closed {owner.workspace_name}. Nothing can be changed now, and everything is deleted for "
        f"good on {out.delete_on}. Ask your owner for a copy of your data before then.",
        skip=owner.id,
    )
    return out


def reopen(conn: psycopg.Connection, owner: CurrentUser) -> ClosingOut:
    row = conn.execute(
        "UPDATE workspaces SET closing_at = NULL, closed_by = NULL WHERE id = %s AND closing_at IS NOT NULL RETURNING id",
        (owner.workspace_id,),
    ).fetchone()
    if row is None:
        raise ConflictError("this business is open")
    audit(conn, owner.workspace_id, owner.display_name, "workspace.reopened", None)
    inbox.notify(
        conn, owner.workspace_id, _everyone(conn, owner.workspace_id), "security", None, owner.display_name,
        f"{owner.display_name} reopened {owner.workspace_name}. Nothing will be deleted.",
        skip=owner.id,
    )
    return state(conn, owner.workspace_id)


def delete_due(conn: psycopg.Connection) -> int:
    """Delete every workspace whose grace period is over. Everything in it goes with it (ON DELETE
    CASCADE); its HQ links and enquiries are let go (ON DELETE SET NULL)."""
    rows = conn.execute(
        "WITH gone AS (DELETE FROM workspaces WHERE closing_at < now() - %s * interval '1 day' "
        "RETURNING id, public_id, name, closing_at, closed_by) "
        "INSERT INTO closed_workspaces (id, public_id, name, closed_at, closed_by, deleted_at) "
        "SELECT id, public_id, name, closing_at, closed_by, now() FROM gone RETURNING id",
        (GRACE_DAYS,),
    ).fetchall()
    return len(rows)
