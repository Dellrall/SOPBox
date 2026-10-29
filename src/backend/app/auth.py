"""Accounts, sign-in sessions and role checks.

Passwords are hashed with scrypt from the standard library. A session is a random token: the
browser holds it in an HttpOnly cookie and the database holds only its SHA-256, so a database
leak does not hand out working sessions.
"""

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Annotated, Any

import psycopg
from fastapi import Depends, Request, Response
from psycopg.types.json import Jsonb

from app import inbox
from app.config import get_settings
from app.db import get_db, scope_to_user, scope_to_workspace
from app.errors import AuthError, ForbiddenError, MfaRequiredError, RateLimitError
from app.models import SignIn

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


# Checking whether a username is free is open to anyone, so cap it per address: plenty for typing,
# too few to list who uses SOPBox.
_USERNAME_CHECKS_PER_MINUTE = 30
_username_checks: dict[str, list[float]] = {}


def check_username_lookup_allowed(client: str) -> None:
    now = time.monotonic()
    with _fails_lock:
        hits = [t for t in _username_checks.get(client, []) if now - t < 60]
        if len(hits) >= _USERNAME_CHECKS_PER_MINUTE:
            raise RateLimitError("too many username checks; wait a minute")
        _username_checks[client] = [*hits, now]


# Any other request count per address or key, in a sliding window.
_hits: dict[str, list[float]] = {}


def limit(bucket: str, client: str, count: int, seconds: int) -> None:
    now = time.monotonic()
    key = f"{bucket}:{client}"
    with _fails_lock:
        hits = [t for t in _hits.get(key, []) if now - t < seconds]
        if len(hits) >= count:
            raise RateLimitError("too many requests; wait a minute and try again")
        _hits[key] = [*hits, now]


# ---- sessions ---------------------------------------------------------------------------------


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# How a person signed in, as shown to them.
METHOD_LABEL = {
    "password": "password",
    "register": "creating the workspace",
    "passkey": "a passkey",
    "google": "Google",
    "telegram": "Telegram",
    "kitchen_pin": "kitchen tablet PIN",
}


def describe_device(user_agent: str) -> str:
    """A rough "Chrome on Android" from the User-Agent, enough for a person to recognise it."""
    ua = user_agent or ""
    system = next(
        (name for pattern, name in (
            (r"iPhone", "iPhone"), (r"iPad", "iPad"), (r"Android", "Android"), (r"Windows", "Windows"),
            (r"Mac OS X|Macintosh", "Mac"), (r"CrOS", "Chromebook"), (r"Linux", "Linux"),
        ) if re.search(pattern, ua)),
        "an unknown device",
    )
    browser = next(
        (name for pattern, name in (
            (r"Edg/", "Edge"), (r"SamsungBrowser", "Samsung Internet"), (r"OPR/|Opera", "Opera"),
            (r"Firefox/|FxiOS", "Firefox"), (r"Chrome/|CriOS", "Chrome"), (r"Safari/", "Safari"),
        ) if re.search(pattern, ua)),
        "a browser",
    )
    return f"{browser} on {system}"


def _record_sign_in(conn: psycopg.Connection, request: Request, user_id: int, method: str) -> int:
    """Log the sign-in. A method and device this person has not used before goes to their inbox,
    so a sign-in they did not make stands out."""
    device = describe_device(request.headers.get("user-agent", ""))
    seen = conn.execute(
        "SELECT 1 FROM sign_ins WHERE user_id = %s AND method = %s AND device = %s LIMIT 1",
        (user_id, method, device),
    ).fetchone()
    first_ever = conn.execute("SELECT 1 FROM sign_ins WHERE user_id = %s LIMIT 1", (user_id,)).fetchone() is None
    sign_in_id = conn.execute(
        "INSERT INTO sign_ins (user_id, at, method, device) VALUES (%s, %s, %s, %s) RETURNING id",
        (user_id, datetime.now(timezone.utc).isoformat(timespec="seconds"), method, device),
    ).fetchone()["id"]
    if not seen and not first_ever:
        ws = conn.execute("SELECT workspace_id FROM users WHERE id = %s", (user_id,)).fetchone()["workspace_id"]
        # Signing in runs before any workspace is set; this person is now proven, so use theirs.
        scope_to_workspace(conn, ws)
        inbox.notify(
            conn, ws, [user_id], "sign_in", None, "SOPBox",
            f"New sign-in with {METHOD_LABEL.get(method, method)} on {device}. "
            "If this wasn't you, change your password in Settings.",
        )
    return sign_in_id


def start_session(
    conn: psycopg.Connection, request: Request, response: Response, user_id: int, method: str, *, days: float = SESSION_DAYS
) -> bool:
    """Every way of signing in ends here: one session cookie, one logged sign-in. With two-step
    sign-in on, the session waits for an authenticator code, except after a passkey (already two
    factors, so it also counts as a fresh code: someone who lost their phone can still sign in with
    a passkey and reset their two-step sign-in). Returns whether it waits."""
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM sessions WHERE expires_at < now()")
    sign_in_id = _record_sign_in(conn, request, user_id, method)
    pending = method != "passkey" and conn.execute(
        "SELECT totp_secret IS NOT NULL AS on FROM users WHERE id = %s", (user_id,)
    ).fetchone()["on"]
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at, sign_in_id, mfa_pending, mfa_at) "
        "VALUES (%s, %s, now() + make_interval(secs => %s), %s, %s, CASE WHEN %s THEN now() END)",
        (token_digest(token), user_id, days * 86400, sign_in_id, pending, method == "passkey"),
    )
    response.set_cookie(
        COOKIE,
        token,
        max_age=int(days * 86400),
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
        path="/",
    )
    return pending


def previous_sign_in(conn: psycopg.Connection, user_id: int, current: int | None) -> SignIn | None:
    """The sign-in before this session's (or before the newest, when the session is not known)."""
    row = conn.execute(
        "SELECT id, at, method, device FROM sign_ins WHERE user_id = %s "
        "AND id < COALESCE(%s, (SELECT max(id) FROM sign_ins WHERE user_id = %s)) ORDER BY id DESC LIMIT 1",
        (user_id, current, user_id),
    ).fetchone()
    return SignIn(**row) if row else None


# ---- two-step sign-ins ------------------------------------------------------------------------
# A passkey challenge or a Google redirect spans two requests. The browser keeps a random token in
# a short-lived cookie; the database keeps its hash with the step's data. Taking a flow deletes it,
# so each one works once.

FLOW_COOKIE = "sopbox_flow"
FLOW_MINUTES = 10


def start_flow(
    conn: psycopg.Connection, response: Response, kind: str, data: dict[str, Any], user_id: int | None = None
) -> None:
    token = secrets.token_urlsafe(32)
    conn.execute("DELETE FROM auth_flows WHERE expires_at < now()")
    conn.execute(
        "INSERT INTO auth_flows (token_hash, kind, user_id, data, expires_at) "
        "VALUES (%s, %s, %s, %s, now() + make_interval(mins => %s))",
        (token_digest(token), kind, user_id, Jsonb(data), FLOW_MINUTES),
    )
    response.set_cookie(
        FLOW_COOKIE, token, max_age=FLOW_MINUTES * 60, httponly=True, samesite="lax",
        secure=get_settings().cookie_secure, path="/api/auth",
    )


def take_flow(conn: psycopg.Connection, request: Request, response: Response, kind: str) -> dict[str, Any]:
    """The flow this browser started, as {"user_id", **data}. Raises if it is missing, expired or another kind."""
    token = request.cookies.get(FLOW_COOKIE)
    response.delete_cookie(FLOW_COOKIE, path="/api/auth")
    row = conn.execute(
        "DELETE FROM auth_flows WHERE token_hash = %s AND kind = %s AND expires_at > now() "
        "RETURNING user_id, data",
        (token_digest(token or ""), kind),
    ).fetchone() if token else None
    if row is None:
        raise AuthError("this sign-in took too long or was started elsewhere; please try again")
    return {"user_id": row["user_id"], **row["data"]}


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
    sign_in_id: int | None = None  # the sign-in that started this session
    mfa_enabled: bool = False
    mfa_policy: str = "off"  # the home workspace's: who must use two-step sign-in
    mfa_pending: bool = False  # this session still waits for an authenticator code
    mfa_fresh: bool = False  # a code was entered in the last few minutes (mfa.FRESH_MINUTES)
    session_hash: str = ""


def _user_for_token(conn: psycopg.Connection, token: str) -> CurrentUser | None:
    row = conn.execute(
        "SELECT u.id, u.workspace_id, w.name AS workspace_name, u.username, u.email, u.display_name, "
        "u.role, u.section_access, s.sign_in_id, u.totp_secret IS NOT NULL AS mfa_enabled, w.mfa_policy, "
        "s.mfa_pending, COALESCE(s.mfa_at > now() - interval '10 minutes', false) AS mfa_fresh, "
        "s.token_hash AS session_hash "
        "FROM sessions s JOIN users u ON u.id = s.user_id JOIN workspaces w ON w.id = u.workspace_id "
        "WHERE s.token_hash = %s AND s.expires_at > now() AND u.active",
        (token_digest(token),),
    ).fetchone()
    return CurrentUser(**row) if row else None


def get_me(conn: psycopg.Connection, user_id: int) -> "CurrentUser":
    row = conn.execute(
        "SELECT u.id, u.workspace_id, w.name AS workspace_name, u.username, u.email, u.display_name, "
        "u.role, u.section_access, u.totp_secret IS NOT NULL AS mfa_enabled, w.mfa_policy "
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


# The browser names the branch an HQ person is working in: a header, or `?workspace=` where it
# cannot set one (an <img>). Account routes (/api/auth/) ignore it: a person's own account always
# lives in their own workspace.
WORKSPACE_HEADER = "X-SOPBox-Workspace"


def in_branch(conn: psycopg.Connection, user: CurrentUser, branch_id: int) -> CurrentUser:
    """The HQ person working in one of their HQ's branches. HQ owners and managers act as managers
    there (so the branch's team and settings stay with its own owner); HQ staff keep the section
    access they have at HQ."""
    if branch_id == user.workspace_id:
        return user
    row = conn.execute(
        "SELECT name FROM workspaces WHERE id = %s AND hq_id = %s", (branch_id, user.workspace_id)
    ).fetchone()
    if row is None:
        raise ForbiddenError("you cannot work in that workspace")
    return replace(
        user,
        workspace_id=branch_id,
        workspace_name=row["name"],
        role="manager" if user.role in ("owner", "manager") else "staff",
    )


def current_user(request: Request, conn: Conn) -> CurrentUser:
    """The signed-in user. Also points the database connection at their workspace."""
    token = request.cookies.get(COOKIE)
    user = _user_for_token(conn, token) if token else None
    if user is None:
        raise AuthError("sign in to continue")
    if user.mfa_pending:
        raise MfaRequiredError("enter the code from your authenticator app to finish signing in")
    branch = request.headers.get(WORKSPACE_HEADER) or request.query_params.get("workspace", "")
    if branch and not request.url.path.startswith("/api/auth/"):
        if not branch.isdecimal() or len(branch) > 18:
            raise ForbiddenError("you cannot work in that workspace")
        user = in_branch(conn, user, int(branch))
    act_as(conn, user)
    return user


def act_as(conn: psycopg.Connection, user: CurrentUser) -> None:
    """Point the connection at this proven user's workspace, and log their actions as theirs."""
    scope_to_user(conn, user.workspace_id, user.id)


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
