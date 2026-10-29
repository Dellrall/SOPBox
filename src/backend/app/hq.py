"""Linking branch workspaces to an HQ workspace.

Each workspace keeps its own id, team, products and records. An HQ owner makes a one-time code
(192 random bits, valid 24 hours, only its SHA-256 stored) and the branch owner enters it. From
then on HQ people can work in the branch with the role they have at HQ (see auth.current_user);
branch people never see HQ or other branches. Either owner can unlink. One level only: an HQ is
never a branch, and a branch has no branches.
"""

import secrets

import psycopg

from app import plans

from app.auditlog import audit
from app.auth import CurrentUser, token_digest
from app.errors import ConflictError, InvalidRequestError, NotFoundError
from app.models import LinkCodeOut, LinksOut, WorkspaceRef

CODE_HOURS = 24


def links(conn: psycopg.Connection, ws: int) -> LinksOut:
    hq = conn.execute(
        "SELECT h.id, h.name FROM workspaces w JOIN workspaces h ON h.id = w.hq_id WHERE w.id = %s", (ws,)
    ).fetchone()
    branches = conn.execute(
        "SELECT id, name FROM workspaces WHERE hq_id = %s ORDER BY lower(name)", (ws,)
    ).fetchall()
    return LinksOut(hq=WorkspaceRef(**hq) if hq else None, branches=[WorkspaceRef(**b) for b in branches])


def create_code(conn: psycopg.Connection, owner: CurrentUser) -> LinkCodeOut:
    plans.require(conn, owner.workspace_id, "hq_links")
    if links(conn, owner.workspace_id).hq is not None:
        raise ConflictError("this workspace is a branch, so it cannot have branches of its own")
    code = secrets.token_urlsafe(24)
    conn.execute("DELETE FROM link_codes WHERE expires_at < now()")
    expires = conn.execute(
        "INSERT INTO link_codes (token_hash, hq_id, created_by, expires_at) "
        "VALUES (%s, %s, %s, now() + make_interval(hours => %s)) RETURNING expires_at",
        (token_digest(code), owner.workspace_id, owner.display_name, CODE_HOURS),
    ).fetchone()["expires_at"]
    audit(conn, owner.workspace_id, owner.display_name, "hq.code_created", None, f"valid for {CODE_HOURS} hours")
    return LinkCodeOut(code=code, expires_at=expires.isoformat(timespec="seconds"))


def join(conn: psycopg.Connection, owner: CurrentUser, code: str) -> LinksOut:
    """Make the owner's workspace a branch of the HQ that made the code. The code works once."""
    ws = owner.workspace_id
    with conn.transaction():
        current = links(conn, ws)
        if current.hq is not None:
            raise ConflictError(f"this workspace is already a branch of {current.hq.name}: unlink it first")
        if current.branches:
            raise ConflictError("this workspace is an HQ with branches, so it cannot become a branch")
        row = conn.execute(
            "UPDATE link_codes SET used_by = %s, used_at = now() "
            "WHERE token_hash = %s AND used_at IS NULL AND expires_at > now() RETURNING hq_id",
            (ws, token_digest(code.strip())),
        ).fetchone()
        # One message for wrong, used and expired codes, so a guess learns nothing.
        if row is None:
            raise InvalidRequestError("this code is not valid: it may be mistyped, used or expired")
        hq = conn.execute(
            "SELECT id, name, hq_id FROM workspaces WHERE id = %s FOR UPDATE", (row["hq_id"],)
        ).fetchone()
        if hq["id"] == ws:
            raise InvalidRequestError("this code was made in this workspace: enter it in the branch")
        if hq["hq_id"] is not None:
            raise ConflictError("the workspace that made this code is now a branch itself")
        conn.execute("UPDATE workspaces SET hq_id = %s WHERE id = %s", (hq["id"], ws))
        audit(conn, ws, owner.display_name, "hq.linked", None, f"linked as a branch of {hq['name']}")
    return links(conn, ws)


def leave(conn: psycopg.Connection, owner: CurrentUser) -> LinksOut:
    """The branch owner unlinks their workspace from its HQ."""
    with conn.transaction():
        current = links(conn, owner.workspace_id)
        if current.hq is None:
            raise ConflictError("this workspace is not linked to an HQ")
        conn.execute("UPDATE workspaces SET hq_id = NULL WHERE id = %s", (owner.workspace_id,))
        audit(conn, owner.workspace_id, owner.display_name, "hq.unlinked", None, f"left {current.hq.name}")
    return links(conn, owner.workspace_id)


def remove_branch(conn: psycopg.Connection, owner: CurrentUser, branch_id: int) -> LinksOut:
    """The HQ owner unlinks one of its branches."""
    with conn.transaction():
        branch = conn.execute(
            "UPDATE workspaces SET hq_id = NULL WHERE id = %s AND hq_id = %s RETURNING name",
            (branch_id, owner.workspace_id),
        ).fetchone()
        if branch is None:
            raise NotFoundError("no such branch")
        audit(conn, owner.workspace_id, owner.display_name, "hq.branch_removed", None, branch["name"])
    return links(conn, owner.workspace_id)
