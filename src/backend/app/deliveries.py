"""The receiving journey: check a delivery, hold failures for a manager, log every step.

Every function takes the caller's `workspace_id` and only touches that workspace's rows.
"""

import json
from datetime import datetime, timezone

import psycopg

from app import catalogue, rules
from app.errors import ConflictError, InvalidRequestError, NotFoundError
from app.models import (
    AuditEntry,
    DecisionIn,
    Delivery,
    DeliveryIn,
    DeliveryLine,
    DeliveryStatus,
)

ACCEPTED: DeliveryStatus = "accepted"
PENDING: DeliveryStatus = "pending_approval"
REJECTED: DeliveryStatus = "rejected"
RETURNED: DeliveryStatus = "returned"

_DECISION_STATUS: dict[str, DeliveryStatus] = {
    "accept": ACCEPTED,
    "reject": REJECTED,
    "return": RETURNED,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def audit(
    conn: psycopg.Connection,
    ws: int,
    actor: str,
    action: str,
    delivery_id: int | None,
    detail: str = "",
) -> None:
    conn.execute(
        "INSERT INTO audit_log (workspace_id, at, actor, action, delivery_id, detail) "
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (ws, _now(), actor, action, delivery_id, detail),
    )


def _add_stock(conn: psycopg.Connection, delivery_id: int) -> None:
    """Add what actually arrived to stock. Lines with no base quantity add nothing."""
    conn.execute(
        """
        UPDATE products SET stock = stock + (
            SELECT COALESCE(SUM(received_base_qty), 0) FROM delivery_lines
            WHERE delivery_id = %s AND product_id = products.id
        )
        WHERE id IN (
            SELECT product_id FROM delivery_lines
            WHERE delivery_id = %s AND product_id IS NOT NULL
        )
        """,
        (delivery_id, delivery_id),
    )


def create_delivery(
    conn: psycopg.Connection, ws: int, received_by: str, data: DeliveryIn
) -> Delivery:
    """Run the rules on every line. All pass: accepted and stocked. Any fail: wait for a manager."""
    products = {p.id: p for p in catalogue.list_products(conn, ws)}
    for line in data.lines:
        if line.product_id is not None and line.product_id not in products:
            raise InvalidRequestError(f"unknown product_id {line.product_id}")

    checks = [rules.check_line(products.get(line.product_id), line) for line in data.lines]
    failed = sum(1 for c in checks if not c.passed)
    status = ACCEPTED if failed == 0 else PENDING

    with conn.transaction():
        delivery_id = conn.execute(
            "INSERT INTO deliveries (workspace_id, supplier, received_by, status, created_at) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (ws, data.supplier, received_by, status, _now()),
        ).fetchone()["id"]
        for line, check in zip(data.lines, checks):
            conn.execute(
                "INSERT INTO delivery_lines (delivery_id, product_id, name, quantity, unit, temp_c, "
                "expected_base_qty, received_base_qty, passed, issues) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    delivery_id,
                    line.product_id,
                    line.name,
                    line.quantity,
                    line.unit,
                    line.temp_c,
                    line.expected_base_qty,
                    check.received_base_qty,
                    check.passed,
                    json.dumps(check.issues),
                ),
            )
        audit(
            conn,
            ws,
            received_by,
            "delivery.received",
            delivery_id,
            f"{len(data.lines)} line(s), {failed} failed",
        )
        if status == ACCEPTED:
            _add_stock(conn, delivery_id)
            audit(conn, ws, "system", "delivery.accepted", delivery_id, "all checks passed")
    return get_delivery(conn, ws, delivery_id)


def decide(
    conn: psycopg.Connection, ws: int, delivery_id: int, decided_by: str, data: DecisionIn
) -> Delivery:
    """A manager accepts, rejects or returns a delivery that is waiting for approval.

    The UPDATE only matches a pending delivery, so two managers deciding at once cannot both win
    and stock cannot be added twice.
    """
    new_status = _DECISION_STATUS[data.decision]
    with conn.transaction():
        cur = conn.execute(
            "UPDATE deliveries SET status = %s, decided_by = %s, decided_at = %s, "
            "decision_reason = %s WHERE id = %s AND workspace_id = %s AND status = %s",
            (new_status, decided_by, _now(), data.reason or None, delivery_id, ws, PENDING),
        )
        if cur.rowcount == 0:
            exists = conn.execute(
                "SELECT 1 FROM deliveries WHERE id = %s AND workspace_id = %s", (delivery_id, ws)
            ).fetchone()
            if exists is None:
                raise NotFoundError(f"delivery {delivery_id} not found")
            raise ConflictError("this delivery is not waiting for approval")
        if new_status == ACCEPTED:
            _add_stock(conn, delivery_id)
        audit(conn, ws, decided_by, f"delivery.{new_status}", delivery_id, data.reason)
    return get_delivery(conn, ws, delivery_id)


def _delivery(conn: psycopg.Connection, row: dict) -> Delivery:
    lines = conn.execute(
        "SELECT * FROM delivery_lines WHERE delivery_id = %s ORDER BY id", (row["id"],)
    ).fetchall()
    return Delivery(
        **row,
        lines=[DeliveryLine(**{**r, "issues": json.loads(r["issues"])}) for r in lines],
    )


def get_delivery(conn: psycopg.Connection, ws: int, delivery_id: int) -> Delivery:
    row = conn.execute(
        "SELECT * FROM deliveries WHERE id = %s AND workspace_id = %s", (delivery_id, ws)
    ).fetchone()
    if row is None:
        raise NotFoundError(f"delivery {delivery_id} not found")
    return _delivery(conn, row)


def list_deliveries(
    conn: psycopg.Connection, ws: int, status: DeliveryStatus | None = None, limit: int = 50
) -> list[Delivery]:
    if status:
        rows = conn.execute(
            "SELECT * FROM deliveries WHERE workspace_id = %s AND status = %s "
            "ORDER BY id DESC LIMIT %s",
            (ws, status, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM deliveries WHERE workspace_id = %s ORDER BY id DESC LIMIT %s", (ws, limit)
        ).fetchall()
    return [_delivery(conn, r) for r in rows]


def list_audit(conn: psycopg.Connection, ws: int, limit: int = 50) -> list[AuditEntry]:
    rows = conn.execute(
        "SELECT * FROM audit_log WHERE workspace_id = %s ORDER BY id DESC LIMIT %s", (ws, limit)
    ).fetchall()
    return [AuditEntry(**r) for r in rows]
