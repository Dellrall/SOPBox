"""Sign in with Google or Telegram, for accounts the owner already created.

Neither creates accounts or matches by email: a person first signs in as usual, then connects
Google or Telegram from Settings. After that, either one signs them straight in.

Google: OpenID Connect authorization-code flow with PKCE, state and nonce. The ID token comes
straight from Google's token endpoint over TLS, which OpenID Connect Core 3.1.3.7 accepts in place
of checking its signature; its issuer, audience, expiry and nonce are still checked.

Telegram: Telegram's login page sends the person back with their id and a hash keyed by our bot
token (core.telegram.org/widgets/login#checking-authorization). The bot's domain must be set with
@BotFather's /setdomain.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any, Literal
from urllib.parse import urlencode

import httpx
import psycopg
from fastapi import Request, Response

from app import auth
from app.auth import CurrentUser
from app.config import get_settings
from app.errors import AuthError, ConflictError

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
TELEGRAM_MAX_AGE = 3600  # seconds a Telegram answer stays usable

Mode = Literal["login", "link"]


class NotLinkedError(AuthError):
    """Google or Telegram confirmed who this is, but no SOPBox account is connected to them."""


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def google_enabled() -> bool:
    s = get_settings()
    return bool(s.google_client_id and s.google_client_secret)


def telegram_bot_id() -> str | None:
    """The bot's numeric id: the public part of its token, which Telegram's login page needs."""
    token = get_settings().telegram_bot_token
    return token.split(":", 1)[0] if ":" in token else None


def _redirect_uri(request: Request) -> str:
    return str(request.base_url).rstrip("/") + "/api/auth/google/callback"


def google_start(conn: psycopg.Connection, request: Request, response: Response, mode: Mode, user: CurrentUser | None) -> str:
    """Remember this attempt and return Google's sign-in address to send the browser to."""
    state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    auth.start_flow(
        conn, response, "google", {"state": state, "nonce": nonce, "verifier": verifier, "mode": mode},
        user.id if user else None,
    )
    return GOOGLE_AUTH_URL + "?" + urlencode({
        "client_id": get_settings().google_client_id,
        "redirect_uri": _redirect_uri(request),
        "response_type": "code",
        "scope": "openid",
        "state": state,
        "nonce": nonce,
        "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()),
        "code_challenge_method": "S256",
        "prompt": "select_account",
    })


def _google_subject(request: Request, code: str, flow: dict[str, Any]) -> str:
    s = get_settings()
    try:
        resp = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "redirect_uri": _redirect_uri(request),
                "grant_type": "authorization_code",
                "code_verifier": flow["verifier"],
            },
            timeout=10,
        )
        resp.raise_for_status()
        payload = resp.json()["id_token"].split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (httpx.HTTPError, KeyError, IndexError, ValueError):
        raise AuthError("Google did not confirm the sign-in") from None
    if (
        claims.get("iss") not in _GOOGLE_ISSUERS
        or claims.get("aud") != s.google_client_id
        or not isinstance(claims.get("exp"), (int, float))
        or claims["exp"] < time.time()
        or not hmac.compare_digest(str(claims.get("nonce", "")), flow["nonce"])
        or not claims.get("sub")
    ):
        raise AuthError("Google did not confirm the sign-in")
    return str(claims["sub"])


def google_finish(conn: psycopg.Connection, request: Request, flow: dict[str, Any], code: str, state: str) -> tuple[Mode, int]:
    """Finish a Google sign-in or connection, given the flow it started (auth.take_flow).
    Returns the mode and the account it was for."""
    if not hmac.compare_digest(state, flow["state"]):
        raise AuthError("this sign-in was started elsewhere; please try again")
    sub = _google_subject(request, code, flow)
    if flow["mode"] == "link":
        _link(conn, flow["user_id"], "google_sub", sub, "Google")
        return "link", flow["user_id"]
    return "login", _linked_user(conn, "google_sub", sub, "Google")


def verify_telegram(data: dict[str, Any]) -> int:
    """The Telegram user id, if Telegram signed this answer for our bot recently."""
    token = get_settings().telegram_bot_token
    received = str(data.get("hash", ""))
    fields = {k: v for k, v in data.items() if k != "hash"}
    check = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    expected = hmac.new(hashlib.sha256(token.encode()).digest(), check.encode(), hashlib.sha256).hexdigest()
    try:
        fresh = time.time() - int(fields.get("auth_date", 0)) < TELEGRAM_MAX_AGE
        telegram_id = int(fields["id"])
    except (KeyError, TypeError, ValueError):
        raise AuthError("Telegram did not confirm the sign-in") from None
    if not token or not received or not hmac.compare_digest(received, expected) or not fresh:
        raise AuthError("Telegram did not confirm the sign-in")
    return telegram_id


def telegram_login(conn: psycopg.Connection, data: dict[str, Any]) -> int:
    return _linked_user(conn, "telegram_id", verify_telegram(data), "Telegram")


def telegram_link(conn: psycopg.Connection, user: CurrentUser, data: dict[str, Any]) -> None:
    _link(conn, user.id, "telegram_id", verify_telegram(data), "Telegram")


def unlink(conn: psycopg.Connection, user: CurrentUser, provider: Literal["google", "telegram"]) -> None:
    column = {"google": "google_sub", "telegram": "telegram_id"}[provider]
    conn.execute(f"UPDATE users SET {column} = NULL WHERE id = %s", (user.id,))


def _link(conn: psycopg.Connection, user_id: int | None, column: str, value: object, provider: str) -> None:
    if user_id is None:
        raise AuthError("sign in first, then connect your account")
    try:
        with conn.transaction():
            conn.execute(f"UPDATE users SET {column} = %s WHERE id = %s", (value, user_id))
    except psycopg.errors.UniqueViolation:
        raise ConflictError(f"this {provider} account is already connected to another SOPBox account") from None


def _linked_user(conn: psycopg.Connection, column: str, value: object, provider: str) -> int:
    row = conn.execute(f"SELECT id FROM users WHERE {column} = %s AND active", (value,)).fetchone()
    if row is None:
        raise NotLinkedError(
            f"this {provider} account is not connected to SOPBox yet. Sign in with your password, "
            f"then connect {provider} in Settings"
        )
    return row["id"]
