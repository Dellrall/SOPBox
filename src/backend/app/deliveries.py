"""The receiving journey: check a delivery, hold failures for a manager, log every step.

Every function takes the caller's `workspace_id` and only touches that workspace's rows.
"""

import base64
import json
from datetime import datetime, timezone

import psycopg

from app import catalogue, purchasing, rules
from app.auditlog import audit
from app.errors import ConflictError, InvalidRequestError, NotFoundError
from app.models import (
    AuditEntry,
    DecisionIn,
    Delivery,
    DeliveryIn,
    DeliveryLine,
    DeliveryPhoto,
    DeliveryStatus,
    PhotoComment,
    PhotoCommentIn,
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
    # Archived products cannot be received; their old deliveries still show them.
    products = {p.id: p for p in catalogue.list_products(conn, ws, active_only=True)}
    for line in data.lines:
        if line.product_id is not None and line.product_id not in products:
            raise InvalidRequestError(f"product {line.product_id} is unknown or archived")

    with conn.transaction():
        lines = list(data.lines)
        po_issues: list[list[str]] = [[] for _ in lines]
        supplier = data.supplier
        if data.purchase_order_id is not None:
            order = purchasing.outstanding_for_receiving(conn, ws, data.purchase_order_id)
            supplier = supplier or order.supplier
            outstanding = {line.product_id: line.outstanding_base_qty for line in order.lines}
            for i, line in enumerate(lines):
                left = outstanding.get(line.product_id) if line.product_id is not None else None
                if left is None:
                    po_issues[i].append(f"not on {order.reference}")
                elif left == 0:
                    po_issues[i].append(f"nothing left to receive for this product on {order.reference}")
                else:
                    # The order, not the person receiving, says how much is expected.
                    lines[i] = line.model_copy(update={"expected_base_qty": left})

        checks = []
        for line, extra in zip(lines, po_issues):
            check = rules.check_line(products.get(line.product_id), line)
            if extra:
                check = check.model_copy(update={"passed": False, "issues": [*check.issues, *extra]})
            checks.append(check)
        failed = sum(1 for c in checks if not c.passed)
        status = ACCEPTED if failed == 0 else PENDING

        delivery_id = conn.execute(
            "INSERT INTO deliveries (workspace_id, supplier, received_by, status, created_at, "
            "purchase_order_id) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (ws, supplier, received_by, status, _now(), data.purchase_order_id),
        ).fetchone()["id"]
        for line, check in zip(lines, checks):
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
        for photo in data.photos:
            conn.execute(
                "INSERT INTO delivery_photos (delivery_id, data, caption) VALUES (%s, %s, %s)",
                (delivery_id, base64.b64decode(photo.data), photo.caption),
            )
        audit(
            conn,
            ws,
            received_by,
            "delivery.received",
            delivery_id,
            f"{len(lines)} line(s), {failed} failed"
            + (f", {len(data.photos)} photo(s)" if data.photos else ""),
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
    number = None
    if row.get("purchase_order_id"):
        number = conn.execute(
            "SELECT number FROM purchase_orders WHERE id = %s", (row["purchase_order_id"],)
        ).fetchone()["number"]
    photos = conn.execute(
        "SELECT id, caption FROM delivery_photos WHERE delivery_id = %s ORDER BY id", (row["id"],)
    ).fetchall()
    comments: dict[int, list[PhotoComment]] = {p["id"]: [] for p in photos}
    if photos:
        for c in conn.execute(
            "SELECT id, photo_id, author, body, created_at FROM delivery_photo_comments "
            "WHERE photo_id = ANY(%s) ORDER BY id",
            (list(comments),),
        ).fetchall():
            comments[c["photo_id"]].append(PhotoComment(**c))
    return Delivery(
        **row,
        purchase_order=purchasing.reference(number) if number else None,
        lines=[DeliveryLine(**{**r, "issues": json.loads(r["issues"])}) for r in lines],
        photos=[DeliveryPhoto(**p, comments=comments[p["id"]]) for p in photos],
    )


def get_photo(conn: psycopg.Connection, ws: int, delivery_id: int, photo_id: int) -> bytes:
    row = conn.execute(
        "SELECT p.data FROM delivery_photos p JOIN deliveries d ON d.id = p.delivery_id "
        "WHERE p.id = %s AND p.delivery_id = %s AND d.workspace_id = %s",
        (photo_id, delivery_id, ws),
    ).fetchone()
    if row is None:
        raise NotFoundError("photo not found")
    return bytes(row["data"])


def comment_on_photo(
    conn: psycopg.Connection, ws: int, delivery_id: int, photo_id: int, author: str, data: PhotoCommentIn
) -> Delivery:
    with conn.transaction():
        get_photo(conn, ws, delivery_id, photo_id)  # 404 unless it is this workspace's
        conn.execute(
            "INSERT INTO delivery_photo_comments (photo_id, author, body, created_at) "
            "VALUES (%s, %s, %s, %s)",
            (photo_id, author, data.body, _now()),
        )
        audit(conn, ws, author, "delivery.photo_comment", delivery_id, data.body[:200])
    return get_delivery(conn, ws, delivery_id)


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
