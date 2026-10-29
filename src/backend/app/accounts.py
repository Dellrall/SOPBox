"""Workspaces and the people in them. The owner (HQ) creates and manages everyone. A manager tied to
an outlet adds staff there, looks after them, and makes or unmakes assistant managers; an assistant
manager adds and looks after the staff too, but cannot disable anyone."""

from datetime import datetime, timezone

import psycopg
from psycopg.types.json import Jsonb

from app import auth, mfa
from app.auditlog import audit
from app.auth import CurrentUser
from app.errors import ConflictError, ForbiddenError, InvalidRequestError, NotFoundError
from app.models import (
    _username,
    normalise_login,
    ProfileUpdateIn,
    RegisterIn,
    UsernameCheck,
    UserCreateIn,
    UserOut,
    UserUpdateIn,
    WorkspaceSettings,
    WorkspaceUpdateIn,
)

_USER_COLUMNS = (
    "id, username, email, display_name, role, section_access, active, created_at, "
    "telegram_id IS NOT NULL AS telegram_linked, team_group_removed_until, security_alerts, "
    "totp_secret IS NOT NULL AS mfa_enabled, can_export, outlet_id, assistant"
)
# What an outlet's assistant manager may change for its staff; the outlet manager may also disable
# people and move them between staff and assistant manager. The rest stays with the owner.
_ASSISTANT_FIELDS = {"display_name", "email", "password", "section_access"}
_MANAGER_FIELDS = _ASSISTANT_FIELDS | {"active", "role", "assistant"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def register_workspace(conn: psycopg.Connection, data: RegisterIn) -> int:
    """Create a workspace and its owner. Returns the owner's user id.

    `workspaces` and `users` have no row-level policy, so this runs before any workspace is set.
    """
    with conn.transaction():
        for attempt in range(5):
            try:
                with conn.transaction():  # a savepoint: a repeated public id is retried with a new one
                    ws = conn.execute(
                        "INSERT INTO workspaces (name, created_at) VALUES (%s, %s) RETURNING id",
                        (data.workspace_name, _now()),
                    ).fetchone()["id"]
                break
            except psycopg.errors.UniqueViolation as e:
                if e.diag.constraint_name != "workspaces_public_id_key" or attempt == 4:
                    raise
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
    outlet_id: int | None = None,
    assistant: bool = False,
) -> int:
    try:
        with conn.transaction():
            return conn.execute(
                "INSERT INTO users (workspace_id, username, email, display_name, role, "
                "section_access, password_hash, created_at, outlet_id, assistant) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    workspace_id, username, email, display_name, role,
                    Jsonb(section_access) if section_access is not None else Jsonb({}),
                    auth.hash_password(password), _now(), outlet_id, assistant,
                ),
            ).fetchone()["id"]
    except psycopg.errors.UniqueViolation as err:
        raise _taken(err) from None


def _taken(err: psycopg.errors.UniqueViolation) -> ConflictError:
    if err.diag.constraint_name == "users_email_key":
        return ConflictError("that email is already used by another account")
    return ConflictError("that username is already taken")


def username_available(conn: psycopg.Connection, username: str, own_id: int | None) -> UsernameCheck:
    """Whether a username could be saved now. Your own counts as free. Save checks again, so two
    people who both saw "available" cannot end up with the same one."""
    try:
        name = _username(username)
    except ValueError as err:
        return UsernameCheck(username=username, available=False, problem=str(err))
    row = conn.execute("SELECT id FROM users WHERE lower(username) = %s", (name,)).fetchone()
    taken = row is not None and row["id"] != own_id
    return UsernameCheck(username=name, available=not taken, problem="that username is already taken" if taken else "")


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
    """Change your own username, name or email."""
    try:
        with conn.transaction():
            if data.username is not None and data.username != user.username:
                conn.execute("UPDATE users SET username = %s WHERE id = %s", (data.username, user.id))
                audit(conn, user.workspace_id, user.display_name, "account.username_changed", None,
                      f"from {user.username} to {data.username}")
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


# ---- the people list: everyone for the owner, one outlet for its manager -----------------------


def _managed_outlet(actor: CurrentUser) -> int | None:
    """None for the owner (everyone); otherwise the manager's outlet. A manager without one manages nobody."""
    if actor.role == "owner":
        return None
    if actor.outlet_id is None:
        raise ForbiddenError("ask the owner to assign you to an outlet to look after its team")
    return actor.outlet_id


def _check_outlet(conn: psycopg.Connection, workspace_id: int, outlet_id: int | None) -> None:
    if outlet_id is not None and not conn.execute(
        "SELECT 1 FROM outlets WHERE id = %s AND workspace_id = %s", (outlet_id, workspace_id)
    ).fetchone():
        raise InvalidRequestError("that outlet is not in this workspace")


def list_users(conn: psycopg.Connection, actor: CurrentUser) -> list[UserOut]:
    outlet = _managed_outlet(actor)
    rows = conn.execute(
        f"SELECT {_USER_COLUMNS} FROM users WHERE workspace_id = %s AND (%s::bigint IS NULL OR outlet_id = %s) "
        "ORDER BY role <> 'owner', role <> 'manager', username",
        (actor.workspace_id, outlet, outlet),
    ).fetchall()
    return [UserOut(**r) for r in rows]


def _title(role: str, assistant: bool) -> str:
    return "assistant manager" if role == "manager" and assistant else role


def create_user(conn: psycopg.Connection, actor: CurrentUser, data: UserCreateIn) -> UserOut:
    if data.assistant and data.role != "manager":
        raise InvalidRequestError("only a manager can be an assistant manager")
    outlet = _managed_outlet(actor)
    if outlet is not None:
        # The outlet manager adds staff and assistant managers; an assistant manager adds staff.
        if data.role == "manager" and not data.assistant:
            raise ForbiddenError("only the owner adds outlet managers")
        if data.role == "manager" and actor.assistant:
            raise ForbiddenError("only the outlet manager adds assistant managers")
        data.outlet_id = outlet  # always to their own outlet
    _check_outlet(conn, actor.workspace_id, data.outlet_id)
    user_id = _insert_user(
        conn, actor.workspace_id, data.username, data.display_name, data.role, data.password,
        data.email, data.section_access.model_dump(), data.outlet_id, data.assistant,
    )
    audit(
        conn, actor.workspace_id, actor.display_name, "user.created", None,
        f"{data.username} ({_title(data.role, data.assistant)})",
    )
    return get_user(conn, actor.workspace_id, user_id)


def get_user(conn: psycopg.Connection, workspace_id: int, user_id: int) -> UserOut:
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
    target = get_user(conn, owner.workspace_id, user_id)
    if target.role == "owner":
        raise InvalidRequestError("the owner account cannot be changed here")
    outlet = _managed_outlet(owner)
    if outlet is not None:
        # The outlet manager looks after its staff and assistant managers; an assistant manager, its staff.
        mine = target.role == "staff" or (target.assistant and not owner.assistant)
        if target.outlet_id != outlet or not mine or target.id == owner.id:
            raise ForbiddenError("you can only change the staff at your outlet")
    # Only what actually changes is written and logged: a repeated click records nothing.
    current = target.model_dump()
    changes = {
        k: v for k, v in data.model_dump(exclude_none=True).items()
        if k == "password" or (current.get(k) or "") != (v or "")
    }
    if "outlet_id" in data.model_fields_set and data.outlet_id != target.outlet_id:
        changes["outlet_id"] = data.outlet_id  # null clears it
    if outlet is not None and changes.keys() - (_ASSISTANT_FIELDS if owner.assistant else _MANAGER_FIELDS):
        raise ForbiddenError("only the outlet manager can do that" if owner.assistant else "only the owner can change that")
    # Staff are never assistants; an outlet's manager only moves people between staff and assistant manager.
    role = changes.get("role", target.role)
    if data.assistant and role != "manager":
        raise InvalidRequestError("only a manager can be an assistant manager")
    promoted = outlet is not None and "role" in changes
    assistant = role == "manager" and (target.assistant or promoted if data.assistant is None else data.assistant)
    if outlet is not None and role == "manager" and not assistant:
        raise ForbiddenError("only the owner makes outlet managers")
    changes.pop("assistant", None)
    if assistant != target.assistant:
        changes["assistant"] = assistant
    if "outlet_id" in changes:
        _check_outlet(conn, owner.workspace_id, changes["outlet_id"])
    resulting_role = changes.get("role", target.role)
    if "section_access" in changes and resulting_role != "staff":
        raise InvalidRequestError("section access can only be assigned to staff accounts")
    if not changes:
        return target
    try:
        _apply_user_changes(conn, owner, target, user_id, changes)
    except psycopg.errors.UniqueViolation as err:
        raise _taken(err) from None
    return get_user(conn, owner.workspace_id, user_id)


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
        if changes.get("mfa_reset"):
            mfa.reset(conn, user_id)
        if "assistant" in changes:
            conn.execute("UPDATE users SET assistant = %s WHERE id = %s", (changes["assistant"], user_id))
        if "outlet_id" in changes:
            conn.execute("UPDATE users SET outlet_id = %s WHERE id = %s", (changes["outlet_id"], user_id))
        if "can_export" in changes:
            conn.execute("UPDATE users SET can_export = %s WHERE id = %s", (changes["can_export"], user_id))
        if "security_alerts" in changes:
            conn.execute(
                "UPDATE users SET security_alerts = %s WHERE id = %s", (changes["security_alerts"], user_id)
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
    if changes.get("mfa_reset"):
        parts.append("two-step sign-in reset")
    if "can_export" in changes:
        parts.append("may download data" if changes["can_export"] else "may no longer download data")
    if "security_alerts" in changes:
        parts.append("gets security alerts" if changes["security_alerts"] else "no longer gets security alerts")
    if "role" in changes or "assistant" in changes:
        parts.append(f"role set to {_title(changes.get('role', 'manager'), changes.get('assistant', False))}")
    if "display_name" in changes:
        parts.append(f"name set to {changes['display_name']}")
    if "email" in changes:
        parts.append("email changed" if changes["email"] else "email removed")
    if "section_access" in changes:
        parts.append("section access changed")
    if "outlet_id" in changes:
        parts.append("outlet changed" if changes["outlet_id"] else "no longer tied to an outlet")
    if "password" in changes:
        parts.append("password reset")
    return ", ".join(parts)


# ---- workspace settings -----------------------------------------------------------------------


def get_workspace(conn: psycopg.Connection, workspace_id: int) -> WorkspaceSettings:
    row = conn.execute(
        "SELECT id, public_id, name, telegram_manager_chat_id, telegram_staff_chat_id, telegram_team_chat_id, "
        "telegram_team_title, telegram_team_invite_link, mfa_policy FROM workspaces "
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
