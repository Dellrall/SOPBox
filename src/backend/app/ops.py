"""For SOPBox's own support team (an admin, or the assistant working for them), never for customers:
hand a workspace to a new owner when the owner asks, sells the business, or cannot be reached.
Check who is asking (and, when the owner cannot be reached, proof such as business registration)
before calling it. Off unless the OPS_TOKEN secret is set (at least 32 characters); send it as
Authorization: Bearer <OPS_TOKEN>."""

import hmac
import psycopg
from fastapi import Depends, Request

from app import auth, inbox
from app.auditlog import audit
from app.config import get_settings
from app.db import scope_to_workspace
from app.errors import AuthError, ConflictError, NotFoundError
from app.models import OpsMember, OpsWorkspaceOut, OwnerTransferIn

ACTOR = "SOPBox support"


def ops_caller(request: Request) -> None:
    token = get_settings().ops_token
    if len(token) < 32:
        raise NotFoundError("not found")
    auth.limit("ops", auth.client_address(request), 30, 60)
    scheme, _, sent = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(sent.strip().encode(), token.encode()):
        raise AuthError("send the operations token as Authorization: Bearer <token>")


Ops = Depends(ops_caller)


def resolve(conn: psycopg.Connection, ref: str) -> int:
    """The workspace from the id a customer reads out of Settings (public_id), or its internal number."""
    row = conn.execute(
        "SELECT id FROM workspaces WHERE public_id = %s UNION ALL SELECT id FROM closed_workspaces WHERE public_id = %s LIMIT 1",
        (ref, ref),
    ).fetchone()
    if row:
        return row["id"]
    if ref.isdecimal() and len(ref) <= 18:
        return int(ref)
    raise NotFoundError("no such workspace")


def workspace(conn: psycopg.Connection, ws: int) -> OpsWorkspaceOut:
    row = conn.execute(
        "SELECT id, public_id, name, to_char(closing_at, 'YYYY-MM-DD') AS closed_on FROM workspaces WHERE id = %s", (ws,)
    ).fetchone()
    if row is None:
        gone = conn.execute(
            "SELECT name, to_char(deleted_at, 'YYYY-MM-DD') AS day FROM closed_workspaces WHERE id = %s", (ws,)
        ).fetchone()
        raise NotFoundError(f"{gone['name']} was closed and deleted on {gone['day']}" if gone else "no such workspace")
    scope_to_workspace(conn, ws)
    members = conn.execute(
        "SELECT id, username, display_name, email, role, active FROM users WHERE workspace_id = %s "
        "ORDER BY role <> 'owner', username",
        (ws,),
    ).fetchall()
    return OpsWorkspaceOut(**row, members=[OpsMember(**m) for m in members])


def transfer_owner(conn: psycopg.Connection, ws: int, data: OwnerTransferIn) -> OpsWorkspaceOut:
    """The new owner must already be an active member. The old owner becomes a manager, or with
    old_owner="remove" (they left, or cannot be reached) is turned off and signed out everywhere."""
    workspace(conn, ws)  # exists, and scopes the connection
    new = conn.execute(
        "SELECT id, display_name, role, active FROM users WHERE workspace_id = %s AND lower(username) = lower(%s)",
        (ws, data.username.strip()),
    ).fetchone()
    if new is None:
        raise NotFoundError("no one with that username in this workspace")
    if new["role"] == "owner":
        raise ConflictError("they are already the owner")
    if not new["active"]:
        raise ConflictError("turn their account back on first")
    old = conn.execute(
        "SELECT id, display_name FROM users WHERE workspace_id = %s AND role = 'owner'", (ws,)
    ).fetchone()
    # One owner per workspace (users_one_owner_key): step the old one down first.
    if data.old_owner == "remove":
        conn.execute("UPDATE users SET role = 'manager', active = FALSE WHERE id = %s", (old["id"],))
        conn.execute("DELETE FROM sessions WHERE user_id = %s", (old["id"],))
    else:
        conn.execute("UPDATE users SET role = 'manager' WHERE id = %s", (old["id"],))
    conn.execute("UPDATE users SET role = 'owner' WHERE id = %s", (new["id"],))
    audit(
        conn, ws, ACTOR, "owner.transferred", None,
        f"{old['display_name']} -> {new['display_name']} ({'removed' if data.old_owner == 'remove' else 'now a manager'}): {data.reason}",
    )
    told = conn.execute(
        "SELECT id FROM users WHERE workspace_id = %s AND active AND (role = 'owner' OR security_alerts OR id = %s)",
        (ws, old["id"]),
    ).fetchall()
    inbox.notify(
        conn, ws, [r["id"] for r in told], "security", None, ACTOR,
        f"SOPBox support made {new['display_name']} the owner, in place of {old['display_name']}. Reason: {data.reason}",
    )
    return workspace(conn, ws)
