"""Lots: each received batch of a product with its expiry date, delivery, order and storage area.

Nobody records which box a sale, count or transfer took. What is left of each lot is worked out from
the storage area's stock: the latest expiry is assumed to be what remains, so the earliest is used
first (first expiry, first out). `used` counts what was disposed of or moved away by a transfer.
"""

from datetime import date, datetime, timezone

import psycopg

from app import insights, locations, purchasing
from app.auditlog import audit
from app.errors import ConflictError, NotFoundError
from app.models import DisposalOut, DisposeIn, LotOut, LotStatus

METHOD_WORDS = {
    "food_waste": "food waste bin (compost or biogas)",
    "donated": "donated (best-before items only)",
    "returned": "returned to the supplier",
    "general_waste": "general waste",
}

_LOTS = f"""
WITH l AS (
    SELECT lot.*, lot.quantity - lot.used AS cap,
        SUM(lot.quantity - lot.used) OVER (
            PARTITION BY lot.product_id, lot.storage_id ORDER BY lot.expiry_on DESC NULLS FIRST, lot.id DESC
        ) AS upto
    FROM stock_lots lot WHERE lot.workspace_id = %s AND lot.quantity > lot.used
)
SELECT l.id, l.number, l.created_at, l.product_id, l.storage_id, l.delivery_id, l.expiry_on, l.quantity,
    l.alerted, s.outlet_id, p.name AS product, p.base_unit, p.warn_days, {locations.LABEL_SQL} AS location,
    GREATEST(0, LEAST(l.cap, COALESCE(sl.quantity, 0) - (l.upto - l.cap))) AS left_qty,
    COALESCE(d.supplier, '') AS supplier, po.number AS po_number
FROM l JOIN products p ON p.id = l.product_id
JOIN storages s ON s.id = l.storage_id JOIN outlets o ON o.id = s.outlet_id
LEFT JOIN stock_levels sl ON sl.product_id = l.product_id AND sl.storage_id = l.storage_id
LEFT JOIN deliveries d ON d.id = l.delivery_id
LEFT JOIN purchase_orders po ON po.id = d.purchase_order_id
WHERE {locations.mine("l.storage_id")}
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def code(number: int, created_at: str) -> str:
    """Short enough to write on a box: L, the year and month received, the lot number."""
    return f"L{created_at[2:4]}{created_at[5:7]}-{number:04d}"


def _status(expiry: date | None, warn_days: int, today: date) -> tuple[LotStatus, int | None]:
    if expiry is None:
        return "no_date", None
    days = (expiry - today).days
    return ("expired" if days < 0 else "soon" if days <= warn_days else "ok"), days


def _lot(r: dict, today: date) -> LotOut:
    status, days = _status(r["expiry_on"], r["warn_days"], today)
    return LotOut(
        id=r["id"],
        code=code(r["number"], r["created_at"]),
        product_id=r["product_id"],
        product=r["product"],
        base_unit=r["base_unit"],
        storage_id=r["storage_id"],
        location=r["location"],
        expiry_on=r["expiry_on"],
        days_left=days,
        status=status,
        left=r["left_qty"],
        received=r["quantity"],
        supplier=r["supplier"],
        delivery_id=r["delivery_id"],
        purchase_order=purchasing.reference(r["po_number"]) if r["po_number"] else None,
        received_at=r["created_at"],
    )


def _rows(conn: psycopg.Connection, ws: int, where: str = "", params: tuple = ()) -> list[dict]:
    return conn.execute(
        f"{_LOTS} {where} ORDER BY l.expiry_on NULLS FIRST, lower(p.name), l.id", (ws, *params)
    ).fetchall()


def _next_number(conn: psycopg.Connection, ws: int) -> int:
    conn.execute("SELECT id FROM workspaces WHERE id = %s FOR UPDATE", (ws,))  # numbers in order
    return conn.execute(
        "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM stock_lots WHERE workspace_id = %s", (ws,)
    ).fetchone()["n"]


def from_delivery(conn: psycopg.Connection, ws: int, delivery_id: int, storage_id: int) -> None:
    """One lot per stocked line of a product that tracks expiry, or that came with a date."""
    lines = conn.execute(
        "SELECT dl.product_id, dl.received_base_qty, dl.expiry_on FROM delivery_lines dl "
        "JOIN products p ON p.id = dl.product_id "
        "WHERE dl.delivery_id = %s AND NOT dl.returned AND dl.received_base_qty > 0 "
        "AND (p.track_expiry OR dl.expiry_on IS NOT NULL) ORDER BY dl.id",
        (delivery_id,),
    ).fetchall()
    if not lines:
        return
    number = _next_number(conn, ws)
    for i, line in enumerate(lines):
        conn.execute(
            "INSERT INTO stock_lots (workspace_id, number, product_id, storage_id, delivery_id, expiry_on, quantity, "
            "created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (ws, number + i, line["product_id"], storage_id, delivery_id, line["expiry_on"], line["received_base_qty"], _now()),
        )


def move(conn: psycopg.Connection, ws: int, product_id: int, source: int, target: int, quantity: int) -> None:
    """A transfer takes the earliest-expiry lots first; they carry on as lots in the target area.
    Call before the stock moves. Stock with no lot moves without one."""
    rows = [
        r
        for r in _rows(conn, ws, "AND l.product_id = %s AND l.storage_id = %s", (product_id, source))
        if r["left_qty"] > 0
    ]
    rows.sort(key=lambda r: (r["expiry_on"] is None, r["expiry_on"] or date.max, r["id"]))
    number = None
    for r in rows:
        if quantity <= 0:
            break
        take = min(quantity, r["left_qty"])
        quantity -= take
        number = number + 1 if number else _next_number(conn, ws)
        conn.execute("UPDATE stock_lots SET used = used + %s WHERE id = %s", (take, r["id"]))
        conn.execute(
            "INSERT INTO stock_lots (workspace_id, number, product_id, storage_id, delivery_id, from_lot_id, expiry_on, "
            "quantity, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (ws, number, product_id, target, r["delivery_id"], r["id"], r["expiry_on"], take, _now()),
        )


def _alert(conn: psycopg.Connection, ws: int, lots: list[LotOut], rows: dict[int, dict]) -> None:
    """Tell everyone at the lot's outlet once when it is about to expire, and again when it has."""
    for lot in lots:
        if lot.status not in ("soon", "expired") or rows[lot.id]["alerted"] == lot.status:
            continue
        conn.execute("UPDATE stock_lots SET alerted = %s WHERE id = %s", (lot.status, lot.id))
        if lot.status == "expired":
            body = (
                f"Expired: {lot.product}, lot {lot.code} at {lot.location} ({lot.left} {lot.base_unit}). "
                "Take it off the shelf, dispose of it and record how on the Expiry page."
            )
        else:
            body = (
                f"Use first: {lot.product}, lot {lot.code} at {lot.location} expires on "
                f"{lot.expiry_on:%d %b} ({lot.left} {lot.base_unit} left)."
            )
        people = conn.execute(
            "SELECT id FROM users WHERE workspace_id = %s AND active AND (outlet_id IS NULL OR outlet_id = %s)",
            (ws, rows[lot.id]["outlet_id"]),
        ).fetchall()
        for p in people:
            conn.execute(
                "INSERT INTO notifications (workspace_id, user_id, kind, delivery_id, actor, body, created_at) "
                "VALUES (%s, %s, 'expiry', %s, 'SOPBox', %s, %s)",
                (ws, p["id"], lot.delivery_id, body[:500], _now()),
            )


def list_lots(conn: psycopg.Connection, ws: int, today: date | None = None) -> list[LotOut]:
    """Lots with stock left in the outlet worked in, earliest expiry first; sends any alerts due."""
    today = today or date.today()
    rows = {r["id"]: r for r in _rows(conn, ws) if r["left_qty"] > 0}
    lots = [_lot(r, today) for r in rows.values()]
    _alert(conn, ws, lots, rows)
    return lots


def _one(conn: psycopg.Connection, ws: int, lot_id: int) -> dict:
    rows = _rows(conn, ws, "AND l.id = %s", (lot_id,))
    if not rows:
        raise NotFoundError(f"lot {lot_id} not found")
    return rows[0]


def set_expiry(conn: psycopg.Connection, ws: int, lot_id: int, expiry_on: date, by: str) -> LotOut:
    r = _one(conn, ws, lot_id)
    conn.execute("UPDATE stock_lots SET expiry_on = %s, alerted = NULL WHERE id = %s", (expiry_on, lot_id))
    audit(conn, ws, by, "lot.expiry_set", r["delivery_id"], f"{code(r['number'], r['created_at'])} {r['product']}: {expiry_on:%d %b %Y}")
    return _lot(_one(conn, ws, lot_id), date.today())


def dispose(conn: psycopg.Connection, ws: int, lot_id: int, data: DisposeIn, by: str) -> DisposalOut:
    """Take some of a lot off the shelf for good: stock goes down and the loss is valued at the latest price."""
    with conn.transaction():
        first = _one(conn, ws, lot_id)
        locations.levels(conn, first["storage_id"], [first["product_id"]])  # lock the shelf, then read again
        r = _one(conn, ws, lot_id)
        if data.quantity > r["left_qty"]:
            raise ConflictError(f"lot {code(r['number'], r['created_at'])} only has {r['left_qty']} {r['base_unit']} left")
        locations.adjust(conn, ws, r["product_id"], r["storage_id"], -data.quantity)
        conn.execute("UPDATE stock_lots SET used = used + %s WHERE id = %s", (data.quantity, lot_id))
        price = insights.latest_prices(conn, ws).get(r["product_id"])
        value = round(price * data.quantity) if price is not None else None
        row = conn.execute(
            "INSERT INTO stock_disposals (workspace_id, lot_id, product_id, storage_id, quantity, method, value_sen, "
            "notes, disposed_by, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (ws, lot_id, r["product_id"], r["storage_id"], data.quantity, data.method, value, data.notes, by, _now()),
        ).fetchone()
        audit(
            conn, ws, by, "stock.disposed", r["delivery_id"],
            f"{code(r['number'], r['created_at'])} {r['product']}: {data.quantity} {r['base_unit']} at {r['location']}, "
            f"{METHOD_WORDS[data.method]}" + (f", RM{value / 100:.2f}" if value is not None else ""),
        )
    return list_disposals(conn, ws, "AND d.id = %s", (row["id"],))[0]


def list_disposals(conn: psycopg.Connection, ws: int, where: str = "", params: tuple = ()) -> list[DisposalOut]:
    rows = conn.execute(
        f"SELECT d.*, lot.number, lot.created_at AS lot_created, COALESCE(p.name, 'Deleted product') AS product, "
        f"COALESCE(p.base_unit, '') AS base_unit, {locations.LABEL_SQL} AS location "
        "FROM stock_disposals d LEFT JOIN stock_lots lot ON lot.id = d.lot_id LEFT JOIN products p ON p.id = d.product_id "
        "JOIN storages s ON s.id = d.storage_id JOIN outlets o ON o.id = s.outlet_id "
        f"WHERE d.workspace_id = %s AND {locations.mine('d.storage_id')} {where} ORDER BY d.id DESC LIMIT 200",
        (ws, *params),
    ).fetchall()
    return [
        DisposalOut(
            id=r["id"],
            lot_code=code(r["number"], r["lot_created"]) if r["number"] else None,
            product=r["product"],
            location=r["location"],
            quantity=r["quantity"],
            base_unit=r["base_unit"],
            method=r["method"],
            value_sen=r["value_sen"],
            notes=r["notes"],
            disposed_by=r["disposed_by"],
            created_at=r["created_at"],
        )
        for r in rows
    ]
