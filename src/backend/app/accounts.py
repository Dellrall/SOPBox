"""Workspaces and the people in them. The owner creates and manages everyone else."""

from datetime import datetime, timezone

import psycopg

from app import auth, deliveries
from app.auth import CurrentUser
from app.errors import ConflictError, InvalidRequestError, NotFoundError
from app.models import (
    RegisterIn,
    UserCreateIn,
    UserOut,
    UserUpdateIn,
    WorkspaceSettings,
    WorkspaceUpdateIn,
)

_USER_COLUMNS = "id, username, display_name, role, active, created_at"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def register_workspace(conn: psycopg.Connection, data: RegisterIn) -> int:
    """Create a workspace and its owner. Returns the owner's user id.

    `workspaces` and `users` have no row-level policy, so this runs before any workspace is set.
    """
    with conn.transaction():
        ws = conn.execute(
            "INSERT INTO workspaces (name, created_at) VALUES (%s, %s) RETURNING id",
            (data.workspace_name, _now()),
        ).fetchone()["id"]
        user_id = _insert_user(
            conn, ws, data.username, data.display_name, "owner", data.password
        )
    return user_id


def _insert_user(
    conn: psycopg.Connection,
    workspace_id: int,
    username: str,
    display_name: str,
    role: str,
    password: str,
) -> int:
    try:
        with conn.transaction():
            return conn.execute(
                "INSERT INTO users (workspace_id, username, display_name, role, password_hash, "
                "created_at) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (workspace_id, username, display_name, role, auth.hash_password(password), _now()),
            ).fetchone()["id"]
    except psycopg.errors.UniqueViolation:
        raise ConflictError("that username is already taken") from None


def authenticate(conn: psycopg.Connection, username: str, password: str) -> int:
    """Return the user id for a correct username and password. Same error for every failure."""
    username = username.strip().lower()
    auth.check_not_locked(username)
    row = conn.execute(
        "SELECT id, password_hash, active FROM users WHERE lower(username) = %s", (username,)
    ).fetchone()
    ok = auth.verify_password(password, row["password_hash"] if row else None)
    if not (ok and row and row["active"]):
        auth.record_failure(username)
        raise auth.AuthError("wrong username or password")
    auth.clear_failures(username)
    return row["id"]


def change_own_password(
    conn: psycopg.Connection, user: CurrentUser, current: str, new: str, keep_token: str | None
) -> None:
    row = conn.execute("SELECT password_hash FROM users WHERE id = %s", (user.id,)).fetchone()
    if not auth.verify_password(current, row["password_hash"]):
        raise InvalidRequestError("the current password is wrong")
    with conn.transaction():
        conn.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s", (auth.hash_password(new), user.id)
        )
        # Sign out every other device, keep this one.
        conn.execute(
            "DELETE FROM sessions WHERE user_id = %s AND token_hash <> %s",
            (user.id, auth.token_digest(keep_token or "")),
        )


# ---- the owner's people list ------------------------------------------------------------------


def list_users(conn: psycopg.Connection, owner: CurrentUser) -> list[UserOut]:
    rows = conn.execute(
        f"SELECT {_USER_COLUMNS} FROM users WHERE workspace_id = %s ORDER BY role <> 'owner', username",
        (owner.workspace_id,),
    ).fetchall()
    return [UserOut(**r) for r in rows]


def create_user(conn: psycopg.Connection, owner: CurrentUser, data: UserCreateIn) -> UserOut:
    user_id = _insert_user(
        conn, owner.workspace_id, data.username, data.display_name, data.role, data.password
    )
    deliveries.audit(
        conn, owner.workspace_id, owner.display_name, "user.created", None,
        f"{data.username} ({data.role})",
    )
    return _get_user(conn, owner.workspace_id, user_id)


def _get_user(conn: psycopg.Connection, workspace_id: int, user_id: int) -> UserOut:
    row = conn.execute(
        f"SELECT {_USER_COLUMNS} FROM users WHERE id = %s AND workspace_id = %s",
        (user_id, workspace_id),
    ).fetchone()
    if row is None:
        raise NotFoundError(f"user {user_id} not found")
    return UserOut(**row)


def update_user(
    conn: psycopg.Connection, owner: CurrentUser, user_id: int, data: UserUpdateIn
) -> UserOut:
    target = _get_user(conn, owner.workspace_id, user_id)
    if target.role == "owner":
        raise InvalidRequestError("the owner account cannot be changed here")
    changes = data.model_dump(exclude_none=True)
    with conn.transaction():
        if "display_name" in changes:
            conn.execute(
                "UPDATE users SET display_name = %s WHERE id = %s", (changes["display_name"], user_id)
            )
        if "role" in changes:
            conn.execute("UPDATE users SET role = %s WHERE id = %s", (changes["role"], user_id))
        if "active" in changes:
            conn.execute("UPDATE users SET active = %s WHERE id = %s", (changes["active"], user_id))
        if "password" in changes:
            conn.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (auth.hash_password(changes["password"]), user_id),
            )
        # A new password, a new role or a disabled account all end the person's current sessions.
        if changes.keys() & {"password", "role", "active"}:
            conn.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
        deliveries.audit(
            conn, owner.workspace_id, owner.display_name, "user.updated", None,
            f"{target.username}: {', '.join(sorted(changes))}",
        )
    return _get_user(conn, owner.workspace_id, user_id)


# ---- workspace settings -----------------------------------------------------------------------


def get_workspace(conn: psycopg.Connection, workspace_id: int) -> WorkspaceSettings:
    row = conn.execute(
        "SELECT id, name, telegram_manager_chat_id, telegram_staff_chat_id FROM workspaces "
        "WHERE id = %s",
        (workspace_id,),
    ).fetchone()
    return WorkspaceSettings(**row)


def update_workspace(
    conn: psycopg.Connection, owner: CurrentUser, data: WorkspaceUpdateIn
) -> WorkspaceSettings:
    changes = data.model_dump(exclude_none=True)
    if changes:
        assignments = ", ".join(f"{column} = %s" for column in changes)
        conn.execute(
            f"UPDATE workspaces SET {assignments} WHERE id = %s",
            (*changes.values(), owner.workspace_id),
        )
        deliveries.audit(
            conn, owner.workspace_id, owner.display_name, "workspace.updated", None,
            ", ".join(sorted(changes)),
        )
    return get_workspace(conn, owner.workspace_id)
