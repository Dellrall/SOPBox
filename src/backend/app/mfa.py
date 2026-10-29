"""Two-step sign-in with an authenticator app (TOTP, RFC 6238), and the check before dangerous actions.

A person turns it on in Settings: SOPBox makes a secret, their app (Google Authenticator, Authy...)
shows a 6-digit code that changes every 30 seconds, and they type one to prove it works. They also
get 10 one-time backup codes, kept only as SHA-256. From then on:
- every sign-in except a passkey (already two factors) waits for a code (auth.start_session);
- a dangerous action (main.dangerous) needs a code entered in the last FRESH_MINUTES.
The owner can require it for owners and managers, or for everyone; until such a person turns it
on, their dangerous actions are refused. Each dangerous action is announced in the inbox and on
Telegram to the workspace's owner and to anyone the owner picked for security alerts.

The secret is stored encrypted (AES-GCM, key MFA_ENCRYPTION_KEY, bound to the account's id), so a
copy of the database alone cannot make codes.

Ways back in for someone who lost their phone, most to least common:
1. a backup code (hashed, not encrypted, so they work even if the server key is lost);
2. a passkey sign-in, which counts as a fresh code, so they can turn two-step off and set it up again;
3. the owner resets it for them (Team, a dangerous action);
4. an owner with none of these: whoever runs the server runs `python -m app.reset_mfa <username>`.
"""

import base64
import hashlib
import hmac
import logging
import secrets
import struct
import time
from urllib.parse import quote

import psycopg
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app import auth, inbox
from app.auditlog import audit
from app.auth import CurrentUser, token_digest
from app.config import get_settings
from app.errors import ConflictError, ForbiddenError, InvalidRequestError, MfaRequiredError
from app.models import MfaEnabledOut, MfaSetupOut

STEP_SECONDS = 30
FRESH_MINUTES = 10  # also in auth._user_for_token's SQL
BACKUP_CODES = 10
WRONG_CODE = "that code is not right: check your phone's clock and use the newest code"
_SEALED = "v1:"

logger = logging.getLogger(__name__)


def _cipher() -> AESGCM | None:
    raw = get_settings().mfa_encryption_key
    if not raw:
        return None
    key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    if len(key) != 32:
        raise ValueError("MFA_ENCRYPTION_KEY must be 32 bytes, base64")
    return AESGCM(key)


def seal(user_id: int, secret: str) -> str:
    """Encrypt an authenticator secret for this account."""
    cipher = _cipher()
    if cipher is None:
        raise ConflictError("two-step sign-in is not set up on this server yet (MFA_ENCRYPTION_KEY)")
    nonce = secrets.token_bytes(12)
    sealed = cipher.encrypt(nonce, secret.encode(), f"user:{user_id}".encode())
    return _SEALED + base64.urlsafe_b64encode(nonce + sealed).decode()


def unseal(user_id: int, stored: str) -> str | None:
    """The secret, or None when it cannot be read (no key, or another key). Secrets saved before
    encryption arrived are plain base32 and are returned as they are (encrypt_stored seals them)."""
    if not stored.startswith(_SEALED):
        return stored
    cipher = _cipher()
    try:
        raw = base64.urlsafe_b64decode(stored[len(_SEALED):])
        return cipher.decrypt(raw[:12], raw[12:], f"user:{user_id}".encode()).decode() if cipher else None
    except Exception:  # noqa: BLE001 - a wrong key or a damaged value: only backup codes work then
        logger.error("cannot decrypt the authenticator secret of user %s; check MFA_ENCRYPTION_KEY", user_id)
        return None


def encrypt_stored(conn: psycopg.Connection) -> int:
    """At start-up: encrypt secrets saved before encryption arrived. Returns how many."""
    if _cipher() is None:
        return 0
    rows = conn.execute(
        "SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL AND totp_secret NOT LIKE 'v1:%%'"
    ).fetchall()
    for row in rows:
        conn.execute("UPDATE users SET totp_secret = %s WHERE id = %s", (seal(row["id"], row["totp_secret"]), row["id"]))
    return len(rows)


def _new_backup_codes(conn: psycopg.Connection, user_id: int) -> list[str]:
    codes = [secrets.token_hex(5) for _ in range(BACKUP_CODES)]
    conn.execute("DELETE FROM mfa_backup_codes WHERE user_id = %s", (user_id,))
    conn.execute(
        "INSERT INTO mfa_backup_codes (user_id, code_hash) SELECT %s, unnest(%s::text[])",
        (user_id, [token_digest(c) for c in codes]),
    )
    return codes


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
    conn.execute("UPDATE users SET totp_pending_secret = %s WHERE id = %s", (seal(user.id, secret), user.id))
    label = quote(f"SOPBox:{user.username}")
    return MfaSetupOut(secret=secret, uri=f"otpauth://totp/{label}?secret={secret}&issuer=SOPBox&digits=6&period=30")


def enable(conn: psycopg.Connection, user: CurrentUser, code: str) -> MfaEnabledOut:
    """Turn it on once a code from the new secret proves the app is set up. Counts as a fresh code."""
    with conn.transaction():
        row = conn.execute(
            "SELECT totp_secret, totp_pending_secret FROM users WHERE id = %s FOR UPDATE", (user.id,)
        ).fetchone()
        if row["totp_secret"]:
            raise ConflictError("two-step sign-in is already on")
        if not row["totp_pending_secret"]:
            raise InvalidRequestError("start the setup again")
        pending = unseal(user.id, row["totp_pending_secret"])
        step = matching_step(pending, code.strip(), 0) if pending else None
        if step is None:
            raise InvalidRequestError(WRONG_CODE)
        conn.execute(
            "UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_last_step = %s "
            "WHERE id = %s",
            (step, user.id),
        )
        codes = _new_backup_codes(conn, user.id)
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
        secret = unseal(user.id, row["totp_secret"]) if row["totp_secret"] else None
        if row["totp_secret"] and len(code) == 6 and code.isdigit():
            step = matching_step(secret, code, row["totp_last_step"]) if secret else None
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


def new_backup_codes(conn: psycopg.Connection, user: CurrentUser) -> MfaEnabledOut:
    """Replace the backup codes, e.g. when most are used. The old ones stop working."""
    if not user.mfa_enabled:
        raise ConflictError("turn on two-step sign-in first")
    with conn.transaction():
        codes = _new_backup_codes(conn, user.id)
        audit(conn, user.workspace_id, user.display_name, "mfa.backup_codes", None, "made new backup codes")
    return MfaEnabledOut(backup_codes=codes)


def reset(conn: psycopg.Connection, user_id: int) -> None:
    """Turn two-step sign-in off for an account (the owner's reset, or reset_mfa). The person signs
    in with just their password next time, and sets it up again if the workspace requires it."""
    conn.execute(
        "UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_last_step = 0 WHERE id = %s",
        (user_id,),
    )
    conn.execute("DELETE FROM mfa_backup_codes WHERE user_id = %s", (user_id,))


def disable(conn: psycopg.Connection, user: CurrentUser) -> None:
    if required(user.mfa_policy, user.role):
        raise ConflictError("your workspace requires two-step sign-in, so it cannot be turned off")
    with conn.transaction():
        reset(conn, user.id)
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
