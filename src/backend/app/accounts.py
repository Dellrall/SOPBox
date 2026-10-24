"""Workspaces and the people in them. The owner creates and manages everyone else."""

from datetime import datetime, timezone

import psycopg
from psycopg.types.json import Jsonb

from app import auth
from app.auditlog import audit
from app.auth import CurrentUser
from app.errors import ConflictError, InvalidRequestError, NotFoundError
from app.models import (
    normalise_login,
    ProfileUpdateIn,
    RegisterIn,
    UserCreateIn,
    UserOut,
    UserUpdateIn,
    WorkspaceSettings,
    WorkspaceUpdateIn,
)

_USER_COLUMNS = "id, username, email, display_name, role, section_access, active, created_at"


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
            conn, ws, data.username, data.display_name, "owner", data.password, data.email
        )
    return user_id


def _insert_user(
    conn: psycopg.Connection,
    workspace_id: int,
    username: str,
    display_name: str,
    role: str,
    password: str,
    email: str | None,
    section_access: dict[str, str] | None = None,
) -> int:
    try:
        with conn.transaction():
            return conn.execute(
                "INSERT INTO users (workspace_id, username, email, display_name, role, "
                "section_access, password_hash, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    workspace_id, username, email, display_name, role,
                    Jsonb(section_access) if section_access is not None else Jsonb({}),
                    auth.hash_password(password), _now(),
                ),
            ).fetchone()["id"]
    except psycopg.errors.UniqueViolation as err:
        raise _taken(err) from None


def _taken(err: psycopg.errors.UniqueViolation) -> ConflictError:
    if err.diag.constraint_name == "users_email_key":
        return ConflictError("that email is already used by another account")
    return ConflictError("that username is already taken")


def authenticate(conn: psycopg.Connection, login: str, password: str) -> int:
    """Return the user id for a correct username (or email) and password. Same error for every failure."""
    login = normalise_login(login)
    auth.check_not_locked(login)
    column = "email" if "@" in login else "username"
    row = conn.execute(
        f"SELECT id, password_hash, active FROM users WHERE lower({column}) = %s", (login,)
    ).fetchone()
    ok = auth.verify_password(password, row["password_hash"] if row else None)
    if not (ok and row and row["active"]):
        auth.record_failure(login)
        raise auth.AuthError("wrong username, email or password")
    auth.clear_failures(login)
    return row["id"]


def update_profile(conn: psycopg.Connection, user: CurrentUser, data: ProfileUpdateIn) -> None:
    """Change your own name or email."""
    try:
        with conn.transaction():
            if data.display_name is not None:
                conn.execute(
                    "UPDATE users SET display_name = %s WHERE id = %s", (data.display_name, user.id)
                )
            if data.email is not None:
                conn.execute(
                    "UPDATE users SET email = %s WHERE id = %s", (data.email or None, user.id)
                )
    except psycopg.errors.UniqueViolation as err:
        raise _taken(err) from None


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
        conn, owner.workspace_id, data.username, data.display_name, data.role, data.password,
        data.email, data.section_access.model_dump(),
    )
    audit(
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
    # Only what actually changes is written and logged: a repeated click records nothing.
    current = target.model_dump()
    changes = {
        k: v for k, v in data.model_dump(exclude_none=True).items()
        if k == "password" or (current.get(k) or "") != (v or "")
    }
    resulting_role = changes.get("role", target.role)
    if "section_access" in changes and resulting_role != "staff":
        raise InvalidRequestError("section access can only be assigned to staff accounts")
    if not changes:
        return target
    try:
        _apply_user_changes(conn, owner, target, user_id, changes)
    except psycopg.errors.UniqueViolation as err:
        raise _taken(err) from None
    return _get_user(conn, owner.workspace_id, user_id)


def _apply_user_changes(
    conn: psycopg.Connection, owner: CurrentUser, target: UserOut, user_id: int, changes: dict
) -> None:
    with conn.transaction():
        if "email" in changes:
            conn.execute("UPDATE users SET email = %s WHERE id = %s", (changes["email"] or None, user_id))
        if "display_name" in changes:
            conn.execute(
                "UPDATE users SET display_name = %s WHERE id = %s", (changes["display_name"], user_id)
            )
        if "role" in changes:
            conn.execute("UPDATE users SET role = %s WHERE id = %s", (changes["role"], user_id))
        if "section_access" in changes:
            conn.execute(
                "UPDATE users SET section_access = %s WHERE id = %s",
                (Jsonb(changes["section_access"]), user_id),
            )
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
        audit(
            conn, owner.workspace_id, owner.display_name, "user.updated", None,
            f"{target.username}: {_describe(changes)}",
        )


def _describe(changes: dict) -> str:
    """What changed, in words, for the activity log. Never the password itself."""
    parts = []
    if "active" in changes:
        parts.append("enabled" if changes["active"] else "disabled")
    if "role" in changes:
        parts.append(f"role set to {changes['role']}")
    if "display_name" in changes:
        parts.append(f"name set to {changes['display_name']}")
    if "email" in changes:
        parts.append("email changed" if changes["email"] else "email removed")
    if "section_access" in changes:
        parts.append("section access changed")
    if "password" in changes:
        parts.append("password reset")
    return ", ".join(parts)


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
        audit(
            conn, owner.workspace_id, owner.display_name, "workspace.updated", None,
            ", ".join(sorted(changes)),
        )
    return get_workspace(conn, owner.workspace_id)
