"""API keys, so a till (POS) or another system can send sales and read stock without a person.

A key belongs to one workspace and one storage area and can do two things there: record sales
(POST /api/v1/sales) and read stock (GET /api/v1/stock). Nothing else accepts it. It is 256 random
bits, shown once; only its SHA-256 is stored, like sessions and link codes. Owners and managers make
and revoke keys in Settings; revoking deletes the row, so the key stops working at once.
"""

import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated

import psycopg
from fastapi import Depends, Request

from app import locations, plans, sales
from app.auditlog import audit
from app import auth
from app.auth import CurrentUser, token_digest
from app.db import get_db, scope_to_workspace
from app.errors import AuthError, InvalidRequestError, NotFoundError
from app.models import ApiKeyCreated, ApiKeyIn, ApiKeyOut, ApiSaleIn, ApiSaleOut, SaleIn

PREFIX = "sopbox_"
PER_MINUTE = 60  # requests per key; a till stuck in a loop cannot flood the server


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def list_keys(conn: psycopg.Connection, ws: int) -> list[ApiKeyOut]:
    rows = conn.execute(
        f"SELECT k.id, k.name, k.hint, {locations.LABEL_SQL} AS storage, k.created_by, k.created_at, "
        "k.last_used_at FROM api_keys k JOIN storages s ON s.id = k.storage_id "
        "JOIN outlets o ON o.id = s.outlet_id WHERE k.workspace_id = %s ORDER BY k.id",
        (ws,),
    ).fetchall()
    return [ApiKeyOut(**r) for r in rows]


def create_key(conn: psycopg.Connection, user: CurrentUser, data: ApiKeyIn) -> ApiKeyCreated:
    ws = user.workspace_id
    plans.require(conn, ws, "api_access")
    storage_id = locations.resolve(conn, ws, data.storage_id)
    key = PREFIX + secrets.token_urlsafe(32)
    with conn.transaction():
        key_id = conn.execute(
            "INSERT INTO api_keys (workspace_id, name, token_hash, hint, storage_id, created_by, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (ws, data.name, token_digest(key), key[-4:], storage_id, user.display_name, _now()),
        ).fetchone()["id"]
        audit(conn, ws, user.display_name, "api_key.created", None,
              f"{data.name}, for {locations.storage_label(conn, ws, storage_id)}")
    made = next(k for k in list_keys(conn, ws) if k.id == key_id)
    return ApiKeyCreated(**made.model_dump(), key=key)


def revoke_key(conn: psycopg.Connection, user: CurrentUser, key_id: int) -> list[ApiKeyOut]:
    ws = user.workspace_id
    with conn.transaction():
        row = conn.execute(
            "DELETE FROM api_keys WHERE id = %s AND workspace_id = %s RETURNING name", (key_id, ws)
        ).fetchone()
        if row is None:
            raise NotFoundError("no such API key")
        audit(conn, ws, user.display_name, "api_key.revoked", None, row["name"])
    return list_keys(conn, ws)


@dataclass(frozen=True)
class KeyClient:
    workspace_id: int
    storage_id: int
    name: str


def key_client(request: Request, conn: Annotated[psycopg.Connection, Depends(get_db)]) -> KeyClient:
    """The API key in the Authorization header. Also points the connection at its workspace."""
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    token = token.strip()
    row = None
    if scheme.lower() == "bearer" and token.startswith(PREFIX) and len(token) <= 100:
        row = conn.execute(
            "UPDATE api_keys SET last_used_at = %s WHERE token_hash = %s "
            "RETURNING id, workspace_id, storage_id, name",
            (_now(), token_digest(token)),
        ).fetchone()
    if row is None:
        raise AuthError("send a valid API key as the header Authorization: Bearer <key>")
    auth.limit("api-key", str(row.pop("id")), PER_MINUTE, 60)
    if request.method != "GET":
        auth.refuse_if_closed(conn, row["workspace_id"])
    scope_to_workspace(conn, row["workspace_id"])
    return KeyClient(**row)


def record_sale(conn: psycopg.Connection, client: KeyClient, data: ApiSaleIn) -> ApiSaleOut:
    """Match the codes like an uploaded sheet does (repeats added up), then record one sale."""
    sold: dict[str, tuple[str, int]] = {}
    for line in data.lines:
        written, total = sold.get(line.code.casefold(), (line.code, 0))
        sold[line.code.casefold()] = (written, total + line.quantity)
    lines, unknown = sales.match(conn, client.workspace_id, client.storage_id, sold)
    if not lines:
        raise InvalidRequestError("none of these product codes belongs to a product: " + ", ".join(sorted(unknown)))
    sale = SaleIn(
        storage_id=client.storage_id,
        sale_date=data.sale_date,
        source=f"API key {client.name}" + (f", {data.reference}" if data.reference else ""),
        lines=[{"product_id": line.product_id, "quantity": line.quantity} for line in lines],
    )
    recorded = sales.create_sale(conn, client.workspace_id, f"API key {client.name}", sale, data.reference)
    return ApiSaleOut(sale=recorded, unknown_codes=sorted(unknown))
