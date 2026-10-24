"""Passkeys: sign in with the phone's fingerprint, face or screen lock instead of typing a password.

A person adds a passkey from Settings while signed in. Signing in with one needs no username: the
phone offers the passkeys it holds for this site (a "discoverable credential"). A passkey belongs to
the site's address, so one added on the development address does not work on the published one.
"""

import json
from datetime import datetime, timezone
from typing import Any

import psycopg
from fastapi import Request, Response
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app import auth
from app.auth import CurrentUser
from app.errors import AuthError, ConflictError, InvalidRequestError, NotFoundError
from app.models import PasskeyOut


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _site(request: Request) -> tuple[str, str]:
    """The relying party id (the host name) and the origin the browser must report."""
    return request.url.hostname or "", str(request.base_url).rstrip("/")


def registration_options(conn: psycopg.Connection, request: Request, response: Response, user: CurrentUser) -> dict[str, Any]:
    rp_id, _ = _site(request)
    existing = conn.execute("SELECT credential_id FROM passkeys WHERE user_id = %s", (user.id,)).fetchall()
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name="SOPBox",
        user_id=str(user.id).encode(),
        user_name=user.username,
        user_display_name=user.display_name,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        # The same phone cannot add a second passkey for the same person.
        exclude_credentials=[PublicKeyCredentialDescriptor(id=bytes(r["credential_id"])) for r in existing],
    )
    auth.start_flow(conn, response, "passkey_register", {"challenge": bytes_to_base64url(options.challenge)}, user.id)
    return json.loads(options_to_json(options))


def register(
    conn: psycopg.Connection, request: Request, response: Response, user: CurrentUser, credential: dict[str, Any], name: str
) -> PasskeyOut:
    flow = auth.take_flow(conn, request, response, "passkey_register")
    if flow["user_id"] != user.id:
        raise AuthError("this passkey was started by someone else; please try again")
    rp_id, origin = _site(request)
    try:
        verified = verify_registration_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(flow["challenge"]),
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=True,
        )
    except (WebAuthnException, KeyError, ValueError, TypeError):
        raise InvalidRequestError("the passkey could not be checked; please try again") from None
    try:
        with conn.transaction():
            row = conn.execute(
                "INSERT INTO passkeys (user_id, credential_id, public_key, sign_count, name, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, name, created_at, last_used_at",
                (user.id, verified.credential_id, verified.credential_public_key, verified.sign_count, name, _now()),
            ).fetchone()
    except psycopg.errors.UniqueViolation:
        raise ConflictError("this passkey is already added") from None
    return PasskeyOut(**row)


def list_passkeys(conn: psycopg.Connection, user_id: int) -> list[PasskeyOut]:
    rows = conn.execute(
        "SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = %s ORDER BY id", (user_id,)
    ).fetchall()
    return [PasskeyOut(**r) for r in rows]


def remove(conn: psycopg.Connection, user_id: int, passkey_id: int) -> None:
    if conn.execute("DELETE FROM passkeys WHERE id = %s AND user_id = %s", (passkey_id, user_id)).rowcount == 0:
        raise NotFoundError("passkey not found")


def login_options(conn: psycopg.Connection, request: Request, response: Response) -> dict[str, Any]:
    rp_id, _ = _site(request)
    # No list of allowed passkeys: the phone offers whichever it holds for this site.
    options = generate_authentication_options(rp_id=rp_id, user_verification=UserVerificationRequirement.REQUIRED)
    auth.start_flow(conn, response, "passkey_login", {"challenge": bytes_to_base64url(options.challenge)})
    return json.loads(options_to_json(options))


def login(conn: psycopg.Connection, request: Request, response: Response, credential: dict[str, Any]) -> int:
    """Return the user id for a valid passkey answer. Same error for every failure."""
    flow = auth.take_flow(conn, request, response, "passkey_login")
    failed = AuthError("that passkey did not work; sign in another way and add it again in Settings")
    try:
        raw_id = base64url_to_bytes(credential["rawId"])
    except (KeyError, TypeError, ValueError):
        raise failed from None
    row = conn.execute(
        "SELECT p.id, p.user_id, p.public_key, p.sign_count FROM passkeys p JOIN users u ON u.id = p.user_id "
        "WHERE p.credential_id = %s AND u.active",
        (raw_id,),
    ).fetchone()
    if row is None:
        raise failed
    rp_id, origin = _site(request)
    try:
        verified = verify_authentication_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(flow["challenge"]),
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=bytes(row["public_key"]),
            credential_current_sign_count=row["sign_count"],
            require_user_verification=True,
        )
    except (WebAuthnException, KeyError, ValueError, TypeError):
        raise failed from None
    conn.execute(
        "UPDATE passkeys SET sign_count = %s, last_used_at = %s WHERE id = %s",
        (verified.new_sign_count, _now(), row["id"]),
    )
    return row["user_id"]
