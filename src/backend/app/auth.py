"""Accounts, sign-in sessions and role checks.

Passwords are hashed with scrypt from the standard library. A session is a random token: the
browser holds it in an HttpOnly cookie and the database holds only its SHA-256, so a database
leak does not hand out working sessions.
"""

import base64
import hashlib
import hmac
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Annotated

import psycopg
from fastapi import Depends, Request, Response

from app.config import get_settings
from app.db import get_db, scope_to_workspace
from app.errors import AuthError, ForbiddenError, RateLimitError

COOKIE = "sopbox_session"
SESSION_DAYS = 7
MIN_PASSWORD = 8

_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}
_DUMMY_SALT = b"\0" * 16

Role = str  # "owner" | "manager" | "staff"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, stored: str | None) -> bool:
    """Constant work whether or not the account exists, so timing does not reveal usernames."""
    try:
        _, salt_b64, digest_b64 = (stored or "").split("$")
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(digest_b64)
    except ValueError:
        salt, expected = _DUMMY_SALT, b""
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return bool(expected) and hmac.compare_digest(digest, expected)


# ---- sign-in throttle -------------------------------------------------------------------------
# Five wrong passwords for one username locks it for 15 minutes. In memory, so it is per server
# process: good enough to stop guessing, and it never locks out the owner permanently.

_MAX_FAILS = 5
_LOCK_SECONDS = 15 * 60
_fails: dict[str, tuple[int, float]] = {}
_fails_lock = threading.Lock()


def check_not_locked(username: str) -> None:
    with _fails_lock:
        count, since = _fails.get(username, (0, 0.0))
        if count >= _MAX_FAILS and time.monotonic() - since < _LOCK_SECONDS:
            raise RateLimitError("too many wrong passwords; try again in 15 minutes")


def record_failure(username: str) -> None:
    with _fails_lock:
        count, since = _fails.get(username, (0, 0.0))
        if time.monotonic() - since >= _LOCK_SECONDS:
            count = 0
        _fails[username] = (count + 1, time.monotonic() if count == 0 else since)


def clear_failures(username: str) -> None:
    with _fails_lock:
        _fails.pop(username, None)


# Workspaces are open to anyone, so cap how many one address can create.
_REGISTER_PER_HOUR = 10
_register_hits: dict[str, list[float]] = {}


def check_register_allowed(client: str) -> None:
    now = time.monotonic()
    with _fails_lock:
        hits = [t for t in _register_hits.get(client, []) if now - t < 3600]
        if len(hits) >= _REGISTER_PER_HOUR:
            raise RateLimitError("too many workspaces created from this address; try again later")
        _register_hits[client] = [*hits, now]


# ---- sessions ---------------------------------------------------------------------------------


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(conn: psycopg.Connection, response: Response, user_id: int) -> None:
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM sessions WHERE expires_at < now()")
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) "
        "VALUES (%s, %s, now() + make_interval(days => %s))",
        (token_digest(token), user_id, SESSION_DAYS),
    )
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
        path="/",
    )


def end_session(conn: psycopg.Connection, request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE)
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = %s", (token_digest(token),))
    response.delete_cookie(COOKIE, path="/")


@dataclass(frozen=True)
class CurrentUser:
    id: int
    workspace_id: int
    workspace_name: str
    username: str
    email: str | None
    display_name: str
    role: Role
    section_access: dict[str, str]


def _user_for_token(conn: psycopg.Connection, token: str) -> CurrentUser | None:
    row = conn.execute(
        "SELECT u.id, u.workspace_id, w.name AS workspace_name, u.username, u.email, u.display_name, "
        "u.role, u.section_access "
        "FROM sessions s JOIN users u ON u.id = s.user_id JOIN workspaces w ON w.id = u.workspace_id "
        "WHERE s.token_hash = %s AND s.expires_at > now() AND u.active",
        (token_digest(token),),
    ).fetchone()
    return CurrentUser(**row) if row else None


def get_me(conn: psycopg.Connection, user_id: int) -> "CurrentUser":
    row = conn.execute(
        "SELECT u.id, u.workspace_id, w.name AS workspace_name, u.username, u.email, u.display_name, "
        "u.role, u.section_access "
        "FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE u.id = %s",
        (user_id,),
    ).fetchone()
    return CurrentUser(**row)


Conn = Annotated[psycopg.Connection, Depends(get_db)]


def optional_user(request: Request, conn: Conn) -> CurrentUser | None:
    """The signed-in user, or None. For the app's first "who am I?" question, where being signed
    out is a normal answer rather than an error."""
    token = request.cookies.get(COOKIE)
    return _user_for_token(conn, token) if token else None


def current_user(request: Request, conn: Conn) -> CurrentUser:
    """The signed-in user. Also points the database connection at their workspace."""
    token = request.cookies.get(COOKIE)
    user = _user_for_token(conn, token) if token else None
    if user is None:
        raise AuthError("sign in to continue")
    scope_to_workspace(conn, user.workspace_id)
    return user


User = Annotated[CurrentUser, Depends(current_user)]


def require_roles(*allowed: Role):
    """Dependency factory: only these roles pass. The owner passes wherever a manager does."""

    def check(user: User) -> CurrentUser:
        if user.role not in allowed:
            raise ForbiddenError("your role cannot do this")
        return user

    return check


def can_access_section(user: CurrentUser, section: str, *, edit: bool = False) -> bool:
    if user.role in ("owner", "manager"):
        return True
    level = user.section_access.get(section, "none")
    return level == "edit" or (not edit and level == "view")


def require_any_section(*sections: str, edit: bool = False):
    """Allow owners/managers as before; staff need the requested access to at least one section."""

    def check(user: User) -> CurrentUser:
        if any(can_access_section(user, section, edit=edit) for section in sections):
            return user
        raise ForbiddenError("you do not have access to this section")

    return check


OwnerOnly = Annotated[CurrentUser, Depends(require_roles("owner"))]
ManagerUp = Annotated[CurrentUser, Depends(require_roles("owner", "manager"))]
