"""Shared kitchen tablets: tap your name, type your PIN.

A manager marks a browser as a kitchen tablet. That browser then shows the workspace's people who
have set a PIN, and nobody else's browser can list them. A PIN alone opens nothing: it only works on
a marked tablet, it is throttled like a password, and the session it starts lasts one shift.
"""

import secrets
from datetime import datetime, timezone

import psycopg
from fastapi import Request, Response

from app import auth
from app.auth import CurrentUser
from app.config import get_settings
from app.errors import AuthError, NotFoundError
from app.models import KitchenDeviceOut, KitchenPerson, KitchenScreen

COOKIE = "sopbox_kitchen"
COOKIE_DAYS = 365
SESSION_DAYS = 0.5  # one shift


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def register_device(conn: psycopg.Connection, response: Response, user: CurrentUser, name: str) -> KitchenDeviceOut:
    token = secrets.token_urlsafe(32)
    row = conn.execute(
        "INSERT INTO kitchen_devices (workspace_id, token_hash, name, created_by, created_at) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id, name, created_by, created_at, last_used_at",
        (user.workspace_id, auth.token_digest(token), name, user.display_name, _now()),
    ).fetchone()
    response.set_cookie(
        COOKIE, token, max_age=COOKIE_DAYS * 86400, httponly=True, samesite="lax",
        secure=get_settings().cookie_secure, path="/",
    )
    return KitchenDeviceOut(**row, this_device=True)


def list_devices(conn: psycopg.Connection, request: Request, ws: int) -> list[KitchenDeviceOut]:
    mine = auth.token_digest(request.cookies.get(COOKIE, ""))
    rows = conn.execute(
        "SELECT id, name, created_by, created_at, last_used_at, token_hash = %s AS this_device "
        "FROM kitchen_devices WHERE workspace_id = %s ORDER BY id",
        (mine, ws),
    ).fetchall()
    return [KitchenDeviceOut(**r) for r in rows]


def remove_device(conn: psycopg.Connection, ws: int, device_id: int) -> None:
    if conn.execute("DELETE FROM kitchen_devices WHERE id = %s AND workspace_id = %s", (device_id, ws)).rowcount == 0:
        raise NotFoundError("kitchen tablet not found")


def forget(conn: psycopg.Connection, request: Request, response: Response) -> None:
    """The tablet itself stops being a kitchen tablet. Holding its cookie is the proof, as for signing in."""
    device = _device(conn, request)
    if device is not None:
        conn.execute("DELETE FROM kitchen_devices WHERE id = %s", (device["id"],))
    response.delete_cookie(COOKIE, path="/")


def _device(conn: psycopg.Connection, request: Request) -> dict | None:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    return conn.execute(
        "SELECT d.id, d.workspace_id, d.name, w.name AS workspace_name FROM kitchen_devices d "
        "JOIN workspaces w ON w.id = d.workspace_id WHERE d.token_hash = %s",
        (auth.token_digest(token),),
    ).fetchone()


def screen(conn: psycopg.Connection, request: Request) -> KitchenScreen | None:
    """What a marked tablet shows on its sign-in page; None on any other browser."""
    device = _device(conn, request)
    if device is None:
        return None
    people = conn.execute(
        "SELECT id, display_name FROM users WHERE workspace_id = %s AND active AND pin_hash IS NOT NULL "
        "ORDER BY lower(display_name)",
        (device["workspace_id"],),
    ).fetchall()
    return KitchenScreen(
        device_name=device["name"], workspace_name=device["workspace_name"], people=[KitchenPerson(**p) for p in people]
    )


def login(conn: psycopg.Connection, request: Request, user_id: int, pin: str) -> int:
    device = _device(conn, request)
    if device is None:
        raise AuthError("this browser is not a kitchen tablet")
    key = f"pin:{user_id}"
    auth.check_not_locked(key)
    row = conn.execute(
        "SELECT pin_hash FROM users WHERE id = %s AND workspace_id = %s AND active",
        (user_id, device["workspace_id"]),
    ).fetchone()
    if not auth.verify_password(pin, row["pin_hash"] if row else None):
        auth.record_failure(key)
        raise AuthError("wrong PIN")
    auth.clear_failures(key)
    conn.execute("UPDATE kitchen_devices SET last_used_at = %s WHERE id = %s", (_now(), device["id"]))
    return user_id


def set_pin(conn: psycopg.Connection, user: CurrentUser, pin: str | None) -> None:
    conn.execute(
        "UPDATE users SET pin_hash = %s WHERE id = %s", (auth.hash_password(pin) if pin else None, user.id)
    )
