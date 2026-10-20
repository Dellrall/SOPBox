"""The receiving journey: check a delivery, hold failures for a manager, log every step."""

import json
import sqlite3
from datetime import datetime, timezone

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


def _audit(
    conn: sqlite3.Connection, actor: str, action: str, delivery_id: int | None, detail: str = ""
) -> None:
    conn.execute(
        "INSERT INTO audit_log (at, actor, action, delivery_id, detail) VALUES (?, ?, ?, ?, ?)",
        (_now(), actor, action, delivery_id, detail),
    )


def _add_stock(conn: sqlite3.Connection, delivery_id: int) -> None:
    """Add what actually arrived to stock. Lines with no base quantity add nothing."""
    conn.execute(
        """
        UPDATE products SET stock = stock + (
            SELECT COALESCE(SUM(received_base_qty), 0) FROM delivery_lines
            WHERE delivery_id = ? AND product_id = products.id
        )
        WHERE id IN (
            SELECT product_id FROM delivery_lines
            WHERE delivery_id = ? AND product_id IS NOT NULL
        )
        """,
        (delivery_id, delivery_id),
    )


def create_delivery(conn: sqlite3.Connection, data: DeliveryIn) -> Delivery:
    """Run the rules on every line. All pass: accepted and stocked. Any fail: wait for a manager."""
    products = {p.id: p for p in catalogue.list_products(conn)}
    for line in data.lines:
        if line.product_id is not None and line.product_id not in products:
            raise InvalidRequestError(f"unknown product_id {line.product_id}")

    checks = [rules.check_line(products.get(line.product_id), line) for line in data.lines]
    failed = sum(1 for c in checks if not c.passed)
    status = ACCEPTED if failed == 0 else PENDING

    with conn:
        cur = conn.execute(
            "INSERT INTO deliveries (supplier, received_by, status, created_at) VALUES (?, ?, ?, ?)",
            (data.supplier, data.received_by, status, _now()),
        )
        delivery_id = cur.lastrowid
        for line, check in zip(data.lines, checks):
            conn.execute(
                "INSERT INTO delivery_lines (delivery_id, product_id, name, quantity, unit, temp_c, "
                "expected_base_qty, received_base_qty, passed, issues) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    delivery_id,
                    line.product_id,
                    line.name,
                    line.quantity,
                    line.unit,
                    line.temp_c,
                    line.expected_base_qty,
                    check.received_base_qty,
                    int(check.passed),
                    json.dumps(check.issues),
                ),
            )
        _audit(
            conn,
            data.received_by,
            "delivery.received",
            delivery_id,
            f"{len(data.lines)} line(s), {failed} failed",
        )
        if status == ACCEPTED:
            _add_stock(conn, delivery_id)
            _audit(conn, "system", "delivery.accepted", delivery_id, "all checks passed")
    return get_delivery(conn, delivery_id)


def decide(conn: sqlite3.Connection, delivery_id: int, data: DecisionIn) -> Delivery:
    """A manager accepts, rejects or returns a delivery that is waiting for approval.

    The UPDATE only matches a pending delivery, so two managers deciding at once cannot both win
    and stock cannot be added twice.
    """
    new_status = _DECISION_STATUS[data.decision]
    with conn:
        cur = conn.execute(
            "UPDATE deliveries SET status = ?, decided_by = ?, decided_at = ?, decision_reason = ? "
            "WHERE id = ? AND status = ?",
            (new_status, data.decided_by, _now(), data.reason or None, delivery_id, PENDING),
        )
        if cur.rowcount == 0:
            exists = conn.execute("SELECT 1 FROM deliveries WHERE id = ?", (delivery_id,)).fetchone()
            if exists is None:
                raise NotFoundError(f"delivery {delivery_id} not found")
            raise ConflictError("this delivery is not waiting for approval")
        if new_status == ACCEPTED:
            _add_stock(conn, delivery_id)
        _audit(conn, data.decided_by, f"delivery.{new_status}", delivery_id, data.reason)
    return get_delivery(conn, delivery_id)


def _lines(conn: sqlite3.Connection, delivery_id: int) -> list[DeliveryLine]:
    rows = conn.execute(
        "SELECT * FROM delivery_lines WHERE delivery_id = ? ORDER BY id", (delivery_id,)
    ).fetchall()
    return [
        DeliveryLine(**{**dict(r), "passed": bool(r["passed"]), "issues": json.loads(r["issues"])})
        for r in rows
    ]


def _delivery(conn: sqlite3.Connection, row: sqlite3.Row) -> Delivery:
    fields = {k: row[k] for k in row.keys()}
    return Delivery(**fields, lines=_lines(conn, row["id"]))


def get_delivery(conn: sqlite3.Connection, delivery_id: int) -> Delivery:
    row = conn.execute("SELECT * FROM deliveries WHERE id = ?", (delivery_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"delivery {delivery_id} not found")
    return _delivery(conn, row)


def list_deliveries(
    conn: sqlite3.Connection, status: DeliveryStatus | None = None, limit: int = 50
) -> list[Delivery]:
    if status:
        rows = conn.execute(
            "SELECT * FROM deliveries WHERE status = ? ORDER BY id DESC LIMIT ?", (status, limit)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM deliveries ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [_delivery(conn, r) for r in rows]


def list_audit(conn: sqlite3.Connection, limit: int = 50) -> list[AuditEntry]:
    rows = conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [AuditEntry(**dict(r)) for r in rows]
