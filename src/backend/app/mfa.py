"""Two-step sign-in with an authenticator app (TOTP, RFC 6238), and the check before dangerous actions.

A person turns it on in Settings: SOPBox makes a secret, their app (Google Authenticator, Authy...)
shows a 6-digit code that changes every 30 seconds, and they type one to prove it works. They also
get 10 one-time backup codes, kept only as SHA-256. From then on:
- every sign-in except a passkey (already two factors) waits for a code (auth.start_session);
- a dangerous action (main.dangerous) needs a code entered in the last FRESH_MINUTES.
The owner can require it for owners and managers, or for everyone; until such a person turns it
on, their dangerous actions are refused. Each dangerous action is announced in the inbox and on
Telegram to the workspace's owner and to anyone the owner picked for security alerts.
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

import psycopg

from app import auth, inbox
from app.auditlog import audit
from app.auth import CurrentUser, token_digest
from app.errors import ConflictError, ForbiddenError, InvalidRequestError, MfaRequiredError
from app.models import MfaEnabledOut, MfaSetupOut

STEP_SECONDS = 30
FRESH_MINUTES = 10  # also in auth._user_for_token's SQL
BACKUP_CODES = 10
WRONG_CODE = "that code is not right: check your phone's clock and use the newest code"


def _code_at(secret: str, step: int) -> str:
    digest = hmac.new(base64.b32decode(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 1_000_000:06d}"


def matching_step(secret: str, code: str, after: int, now: float | None = None) -> int | None:
    """The 30-second step this code belongs to, allowing one step of clock drift either way. Only a
    step later than `after` (the last one used) counts, so each code works once."""
    current = int((time.time() if now is None else now) // STEP_SECONDS)
    for step in (current - 1, current, current + 1):
        if step > after and hmac.compare_digest(_code_at(secret, step), code):
            return step
    return None


def required(policy: str, role: str) -> bool:
    return policy == "everyone" or (policy == "managers" and role in ("owner", "manager"))


def require_fresh(user: CurrentUser) -> None:
    """Before a dangerous action: a recent code, or two-step sign-in set up when it is required."""
    if user.mfa_enabled:
        if not user.mfa_fresh:
            raise MfaRequiredError("enter a code from your authenticator app to do this")
    elif required(user.mfa_policy, user.role):
        raise ForbiddenError("your workspace requires two-step sign-in: turn it on in Settings first")


def setup(conn: psycopg.Connection, user: CurrentUser) -> MfaSetupOut:
    if user.mfa_enabled:
        raise ConflictError("two-step sign-in is already on")
    secret = base64.b32encode(secrets.token_bytes(20)).decode()
    conn.execute("UPDATE users SET totp_pending_secret = %s WHERE id = %s", (secret, user.id))
    label = quote(f"SOPBox:{user.username}")
    return MfaSetupOut(secret=secret, uri=f"otpauth://totp/{label}?secret={secret}&issuer=SOPBox&digits=6&period=30")


def enable(conn: psycopg.Connection, user: CurrentUser, code: str) -> MfaEnabledOut:
    """Turn it on once a code from the new secret proves the app is set up. Counts as a fresh code."""
    codes = [secrets.token_hex(5) for _ in range(BACKUP_CODES)]
    with conn.transaction():
        row = conn.execute(
            "SELECT totp_secret, totp_pending_secret FROM users WHERE id = %s FOR UPDATE", (user.id,)
        ).fetchone()
        if row["totp_secret"]:
            raise ConflictError("two-step sign-in is already on")
        if not row["totp_pending_secret"]:
            raise InvalidRequestError("start the setup again")
        step = matching_step(row["totp_pending_secret"], code.strip(), 0)
        if step is None:
            raise InvalidRequestError(WRONG_CODE)
        conn.execute(
            "UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_last_step = %s "
            "WHERE id = %s",
            (step, user.id),
        )
        conn.execute("DELETE FROM mfa_backup_codes WHERE user_id = %s", (user.id,))
        conn.execute(
            "INSERT INTO mfa_backup_codes (user_id, code_hash) SELECT %s, unnest(%s::text[])",
            (user.id, [token_digest(c) for c in codes]),
        )
        conn.execute("UPDATE sessions SET mfa_at = now() WHERE token_hash = %s", (user.session_hash,))
        audit(conn, user.workspace_id, user.display_name, "mfa.enabled", None, "two-step sign-in turned on")
    return MfaEnabledOut(backup_codes=codes)


def verify(conn: psycopg.Connection, user: CurrentUser, code: str) -> None:
    """A code from the app, or a backup code (used up). Finishes a waiting sign-in and makes the
    session fresh for dangerous actions. Five wrong codes lock it for 15 minutes."""
    key = f"mfa:{user.id}"
    auth.check_not_locked(key)
    code = code.replace(" ", "").replace("-", "").lower()
    with conn.transaction():
        row = conn.execute(
            "SELECT totp_secret, totp_last_step FROM users WHERE id = %s FOR UPDATE", (user.id,)
        ).fetchone()
        ok = False
        if row["totp_secret"] and len(code) == 6 and code.isdigit():
            step = matching_step(row["totp_secret"], code, row["totp_last_step"])
            if step is not None:
                conn.execute("UPDATE users SET totp_last_step = %s WHERE id = %s", (step, user.id))
                ok = True
        elif row["totp_secret"]:
            ok = conn.execute(
                "DELETE FROM mfa_backup_codes WHERE user_id = %s AND code_hash = %s RETURNING 1",
                (user.id, token_digest(code)),
            ).fetchone() is not None
        if ok:
            conn.execute(
                "UPDATE sessions SET mfa_pending = FALSE, mfa_at = now() WHERE token_hash = %s",
                (user.session_hash,),
            )
    if not ok:
        auth.record_failure(key)
        raise InvalidRequestError(WRONG_CODE)
    auth.clear_failures(key)


def disable(conn: psycopg.Connection, user: CurrentUser) -> None:
    if required(user.mfa_policy, user.role):
        raise ConflictError("your workspace requires two-step sign-in, so it cannot be turned off")
    with conn.transaction():
        conn.execute(
            "UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL WHERE id = %s", (user.id,)
        )
        conn.execute("DELETE FROM mfa_backup_codes WHERE user_id = %s", (user.id,))
        audit(conn, user.workspace_id, user.display_name, "mfa.disabled", None, "two-step sign-in turned off")


def alert(conn: psycopg.Connection, user: CurrentUser, action: str) -> tuple[str, list[str]]:
    """Tell the owner and the people picked for security alerts, in their inboxes. Returns the
    message and the Telegram chats of those who linked Telegram, to send after the response."""
    rows = conn.execute(
        "SELECT id, telegram_id FROM users WHERE workspace_id = %s AND active "
        "AND (role = 'owner' OR security_alerts) AND id <> %s",
        (user.workspace_id, user.id),
    ).fetchall()
    body = f"{user.display_name} {action}" + ("" if user.mfa_enabled else " (without two-step sign-in)")
    inbox.notify(conn, user.workspace_id, [r["id"] for r in rows], "security", None, user.display_name, body)
    return body, [str(r["telegram_id"]) for r in rows if r["telegram_id"]]
