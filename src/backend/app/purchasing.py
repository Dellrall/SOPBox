"""Suppliers and quantity-only purchase orders, and what each order has received so far.

A purchase order is a draft until a manager issues it; only an issued order can be received
against. What has arrived is never stored on the order: it is summed from the deliveries that
name it, so a delivery that a manager rejects simply stops counting.
"""

from datetime import date, datetime, timezone

import psycopg

from app import catalogue, insights, rules
from app.auditlog import audit
from app.errors import ConflictError, InvalidRequestError, NotFoundError
from app.models import (
    LowStockDraftIn,
    LowStockSupplier,
    Product,
    PurchaseOrder,
    PurchaseOrderIn,
    PurchaseOrderLine,
    PurchaseOrderLineIn,
    ReorderSuggestion,
    Supplier,
    SupplierIn,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def reference(number: int) -> str:
    return f"PO-{number:04d}"


# ---- suppliers ----------------------------------------------------------------------------------


def list_suppliers(conn: psycopg.Connection, ws: int) -> list[Supplier]:
    rows = conn.execute(
        "SELECT * FROM suppliers WHERE workspace_id = %s ORDER BY archived, lower(name)", (ws,)
    ).fetchall()
    return [Supplier(**r) for r in rows]


def _get_supplier(conn: psycopg.Connection, ws: int, supplier_id: int) -> Supplier:
    row = conn.execute(
        "SELECT * FROM suppliers WHERE id = %s AND workspace_id = %s", (supplier_id, ws)
    ).fetchone()
    if row is None:
        raise NotFoundError(f"supplier {supplier_id} not found")
    return Supplier(**row)


def _check_products(conn: psycopg.Connection, ws: int, product_ids: list[int]) -> None:
    """Every product a supplier is linked to must be one of this workspace's products."""
    if not product_ids:
        return
    found = conn.execute(
        "SELECT count(*) AS n FROM products WHERE workspace_id = %s AND id = ANY(%s)", (ws, product_ids)
    ).fetchone()["n"]
    if found != len(product_ids):
        raise InvalidRequestError("one of the chosen products does not exist")


def create_supplier(conn: psycopg.Connection, ws: int, data: SupplierIn) -> Supplier:
    product_ids = data.product_ids or []
    _check_products(conn, ws, product_ids)
    row = conn.execute(
        "INSERT INTO suppliers (workspace_id, name, contact, phone, email, product_ids) "
        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
        (ws, data.name, data.contact, data.phone, data.email, product_ids),
    ).fetchone()
    return Supplier(**row)


def update_supplier(conn: psycopg.Connection, ws: int, supplier_id: int, data: SupplierIn) -> Supplier:
    if data.product_ids is not None:
        _check_products(conn, ws, data.product_ids)
    row = conn.execute(
        "UPDATE suppliers SET name = %s, contact = %s, phone = %s, email = %s, "
        "product_ids = COALESCE(%s, product_ids) "
        "WHERE id = %s AND workspace_id = %s RETURNING *",
        (data.name, data.contact, data.phone, data.email, data.product_ids, supplier_id, ws),
    ).fetchone()
    if row is None:
        raise NotFoundError(f"supplier {supplier_id} not found")
    return Supplier(**row)


def set_supplier_archived(conn: psycopg.Connection, ws: int, supplier_id: int, archived: bool) -> Supplier:
    row = conn.execute(
        "UPDATE suppliers SET archived = %s WHERE id = %s AND workspace_id = %s RETURNING *",
        (archived, supplier_id, ws),
    ).fetchone()
    if row is None:
        raise NotFoundError(f"supplier {supplier_id} not found")
    return Supplier(**row)


# ---- reading orders -----------------------------------------------------------------------------


def _received_by_product(conn: psycopg.Connection, order_id: int) -> dict[int, dict[str, int]]:
    """Base units per product on deliveries against this order: accepted, and still pending."""
    rows = conn.execute(
        "SELECT l.product_id, d.status, SUM(l.received_base_qty) AS qty "
        "FROM delivery_lines l JOIN deliveries d ON d.id = l.delivery_id "
        "WHERE d.purchase_order_id = %s AND d.status IN ('accepted', 'pending_approval') "
        "AND l.product_id IS NOT NULL AND l.received_base_qty IS NOT NULL AND NOT l.returned "
        "GROUP BY l.product_id, d.status",
        (order_id,),
    ).fetchall()
    found: dict[int, dict[str, int]] = {}
    for r in rows:
        found.setdefault(r["product_id"], {})[r["status"]] = int(r["qty"])
    return found


def _order(conn: psycopg.Connection, row: dict) -> PurchaseOrder:
    received = _received_by_product(conn, row["id"])
    lines = []
    for r in conn.execute(
        "SELECT l.*, p.name AS product_name, p.base_unit FROM purchase_order_lines l "
        "JOIN products p ON p.id = l.product_id WHERE l.purchase_order_id = %s ORDER BY l.id",
        (row["id"],),
    ).fetchall():
        got = received.get(r["product_id"], {})
        accepted, pending = got.get("accepted", 0), got.get("pending_approval", 0)
        lines.append(
            PurchaseOrderLine(
                id=r["id"],
                product_id=r["product_id"],
                product_name=r["product_name"],
                quantity=r["quantity"],
                unit=r["unit"],
                base_unit=r["base_unit"],
                ordered_base_qty=r["ordered_base_qty"],
                received_base_qty=accepted,
                pending_base_qty=pending,
                outstanding_base_qty=max(0, r["ordered_base_qty"] - accepted - pending),
            )
        )
    if lines and all(line.received_base_qty >= line.ordered_base_qty for line in lines):
        receiving = "fully_received"
    elif any(line.received_base_qty for line in lines):
        receiving = "partially_received"
    else:
        receiving = "not_received"
    delivery_ids = [
        r["id"]
        for r in conn.execute(
            "SELECT id FROM deliveries WHERE purchase_order_id = %s ORDER BY id", (row["id"],)
        ).fetchall()
    ]
    return PurchaseOrder(
        id=row["id"],
        reference=reference(row["number"]),
        supplier_id=row["supplier_id"],
        supplier=row["supplier"],
        status=row["status"],
        receiving_status=receiving,
        order_date=row["order_date"],
        expected_date=row["expected_date"],
        notes=row["notes"],
        created_by=row["created_by"],
        created_at=row["created_at"],
        issued_by=row["issued_by"],
        issued_at=row["issued_at"],
        cancelled_by=row["cancelled_by"],
        cancelled_at=row["cancelled_at"],
        lines=lines,
        delivery_ids=delivery_ids,
    )


_ORDER_SELECT = (
    "SELECT o.*, s.name AS supplier FROM purchase_orders o "
    "JOIN suppliers s ON s.id = o.supplier_id WHERE o.workspace_id = %s"
)


def list_orders(conn: psycopg.Connection, ws: int, status: str | None = None) -> list[PurchaseOrder]:
    if status:
        rows = conn.execute(f"{_ORDER_SELECT} AND o.status = %s ORDER BY o.number DESC", (ws, status))
    else:
        rows = conn.execute(f"{_ORDER_SELECT} ORDER BY o.number DESC", (ws,))
    return [_order(conn, r) for r in rows.fetchall()]


def get_order(conn: psycopg.Connection, ws: int, order_id: int, *, lock: bool = False) -> PurchaseOrder:
    # FOR UPDATE OF o: two deliveries against one order wait for each other, so the second sees
    # what the first took off the outstanding quantity.
    suffix = " FOR UPDATE OF o" if lock else ""
    row = conn.execute(f"{_ORDER_SELECT} AND o.id = %s{suffix}", (ws, order_id)).fetchone()
    if row is None:
        raise NotFoundError(f"purchase order {order_id} not found")
    return _order(conn, row)


# ---- writing orders -----------------------------------------------------------------------------


def _check_supplier(conn: psycopg.Connection, ws: int, supplier_id: int) -> Supplier:
    supplier = conn.execute(
        "SELECT * FROM suppliers WHERE id = %s AND workspace_id = %s", (supplier_id, ws)
    ).fetchone()
    if supplier is None or supplier["archived"]:
        raise InvalidRequestError("choose an active supplier")
    return Supplier(**supplier)


def _priced_lines(conn: psycopg.Connection, ws: int, lines: list[PurchaseOrderLineIn]) -> list[tuple]:
    """Each line with its quantity converted to base units, using the product's pack sizes now."""
    products = {p.id: p for p in catalogue.list_products(conn, ws, active_only=True)}
    out = []
    for line in lines:
        product = products.get(line.product_id)
        if product is None:
            raise InvalidRequestError(f"product {line.product_id} is unknown or archived")
        try:
            base = rules.to_base_units(product, line.quantity, line.unit)
        except ValueError as err:
            raise InvalidRequestError(str(err)) from None
        if base > 10_000_000:
            raise InvalidRequestError(f"{product.name}: that quantity is too large")
        unit = line.unit if line.unit.lower() != product.base_unit.lower() else product.base_unit
        out.append((line.product_id, line.quantity, unit, base))
    return out


def _write_lines(conn: psycopg.Connection, order_id: int, lines: list[tuple]) -> None:
    conn.execute("DELETE FROM purchase_order_lines WHERE purchase_order_id = %s", (order_id,))
    for product_id, quantity, unit, base in lines:
        conn.execute(
            "INSERT INTO purchase_order_lines (purchase_order_id, product_id, quantity, unit, "
            "ordered_base_qty) VALUES (%s, %s, %s, %s, %s)",
            (order_id, product_id, quantity, unit, base),
        )


def _insert_order(
    conn: psycopg.Connection, ws: int, actor: str, supplier_id: int, order_date: date,
    expected_date: date | None, notes: str, lines: list[tuple],
) -> int:
    with conn.transaction():
        # One workspace's numbers are sequential. The lock makes two creates take turns.
        conn.execute("SELECT pg_advisory_xact_lock(7462, %s)", (ws,))
        number = conn.execute(
            "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM purchase_orders WHERE workspace_id = %s",
            (ws,),
        ).fetchone()["n"]
        order_id = conn.execute(
            "INSERT INTO purchase_orders (workspace_id, number, supplier_id, status, order_date, "
            "expected_date, notes, created_by, created_at) "
            "VALUES (%s, %s, %s, 'draft', %s, %s, %s, %s, %s) RETURNING id",
            (ws, number, supplier_id, order_date.isoformat(),
             expected_date.isoformat() if expected_date else None, notes, actor, _now()),
        ).fetchone()["id"]
        _write_lines(conn, order_id, lines)
        audit(conn, ws, actor, "po.created", None, f"{reference(number)}: {len(lines)} line(s)")
    return order_id


def create_order(conn: psycopg.Connection, ws: int, actor: str, data: PurchaseOrderIn) -> PurchaseOrder:
    _check_supplier(conn, ws, data.supplier_id)
    lines = _priced_lines(conn, ws, data.lines)
    order_id = _insert_order(
        conn, ws, actor, data.supplier_id, data.order_date, data.expected_date, data.notes, lines
    )
    return get_order(conn, ws, order_id)


def update_order(
    conn: psycopg.Connection, ws: int, actor: str, order_id: int, data: PurchaseOrderIn
) -> PurchaseOrder:
    _check_supplier(conn, ws, data.supplier_id)
    lines = _priced_lines(conn, ws, data.lines)
    with conn.transaction():
        current = get_order(conn, ws, order_id, lock=True)
        if current.status != "draft":
            raise ConflictError("only a draft purchase order can be edited")
        conn.execute(
            "UPDATE purchase_orders SET supplier_id = %s, order_date = %s, expected_date = %s, "
            "notes = %s WHERE id = %s",
            (data.supplier_id, data.order_date.isoformat(),
             data.expected_date.isoformat() if data.expected_date else None, data.notes, order_id),
        )
        _write_lines(conn, order_id, lines)
        audit(conn, ws, actor, "po.updated", None, current.reference)
    return get_order(conn, ws, order_id)


def issue_order(conn: psycopg.Connection, ws: int, actor: str, order_id: int) -> PurchaseOrder:
    with conn.transaction():
        current = get_order(conn, ws, order_id, lock=True)
        if current.status != "draft":
            raise ConflictError("only a draft purchase order can be issued")
        _check_supplier(conn, ws, current.supplier_id)
        conn.execute(
            "UPDATE purchase_orders SET status = 'issued', issued_by = %s, issued_at = %s WHERE id = %s",
            (actor, _now(), order_id),
        )
        audit(conn, ws, actor, "po.issued", None, f"{current.reference} to {current.supplier}")
    return get_order(conn, ws, order_id)


def cancel_order(conn: psycopg.Connection, ws: int, actor: str, order_id: int, reason: str) -> PurchaseOrder:
    with conn.transaction():
        current = get_order(conn, ws, order_id, lock=True)
        if current.status == "cancelled":
            raise ConflictError("this purchase order is already cancelled")
        # Deliveries against it are stock history: an order that has any stays on record.
        if current.delivery_ids:
            raise ConflictError("goods were already received against this purchase order, so it cannot be cancelled")
        conn.execute(
            "UPDATE purchase_orders SET status = 'cancelled', cancelled_by = %s, cancelled_at = %s "
            "WHERE id = %s",
            (actor, _now(), order_id),
        )
        audit(conn, ws, actor, "po.cancelled", None, f"{current.reference}: {reason}".rstrip(": "))
    return get_order(conn, ws, order_id)


def reorder_suggestions(
    conn: psycopg.Connection, ws: int
) -> tuple[list[ReorderSuggestion], dict[int, list[str]]]:
    """Products running low, with how much of each is still to order and why, and the open
    orders covering each.

    Running low is below the minimum, or with less than insights.COVER_DAYS of recent use left on
    top of it. Quantities already on open orders (drafts, and issued orders still outstanding) are
    taken off, so pressing the button twice does not order the same shortfall twice.
    """
    on_order: dict[int, int] = {}
    covering: dict[int, list[str]] = {}  # product -> the open orders that already cover it
    for order in list_orders(conn, ws):
        if order.status == "cancelled":
            continue
        for line in order.lines:
            still = line.ordered_base_qty if order.status == "draft" else line.outstanding_base_qty
            on_order[line.product_id] = on_order.get(line.product_id, 0) + still
            if still > 0:
                covering.setdefault(line.product_id, []).append(f"{order.reference} ({order.status})")
    products = catalogue.list_products(conn, ws, active_only=True)
    return insights.reorder(products, insights.daily_use(conn, ws), on_order), covering


def _shortfalls(
    conn: psycopg.Connection, ws: int
) -> tuple[list[Product], dict[int, int], dict[int, list[str]]]:
    """Products running low, how much of each is still to order, and the open orders covering each."""
    suggestions, covering = reorder_suggestions(conn, ws)
    low_ids = {s.product_id for s in suggestions}
    low = [p for p in catalogue.list_products(conn, ws, active_only=True) if p.id in low_ids]
    return low, {s.product_id: s.quantity for s in suggestions if s.quantity > 0}, covering


def low_stock_suppliers(conn: psycopg.Connection, ws: int) -> list[LowStockSupplier]:
    """The active suppliers a low-stock draft would order something from: those whose product
    list has a product still to order, then those with no list (offered everything low)."""
    low, short, _ = _shortfalls(conn, ws)
    needed = [p for p in low if p.id in short]
    out = []
    for s in list_suppliers(conn, ws):
        sells = set(s.product_ids)
        names = [p.name for p in needed if not sells or p.id in sells]
        if not s.archived and names:
            out.append(LowStockSupplier(supplier_id=s.id, name=s.name, products=names, has_product_list=bool(sells)))
    return sorted(out, key=lambda x: not x.has_product_list)


def low_stock_draft(conn: psycopg.Connection, ws: int, actor: str, data: LowStockDraftIn) -> PurchaseOrder:
    """A draft order for every product running low, for its minimum plus a week of recent use."""
    supplier = _check_supplier(conn, ws, data.supplier_id)
    low, short, covering = _shortfalls(conn, ws)
    # A supplier with a product list only gets an order for what they sell.
    sells = set(supplier.product_ids)
    mine = [p for p in low if not sells or p.id in sells]
    lines = [(p.id, short[p.id], p.base_unit, short[p.id]) for p in mine if p.id in short]
    if not lines:
        if not low:
            raise InvalidRequestError("nothing needs reordering: no product is below its minimum or running out")
        if not mine:
            raise InvalidRequestError(
                f"nothing needs reordering from {supplier.name}: none of the low-stock products "
                f"({', '.join(p.name for p in low)}) is on their product list. Pick another supplier, "
                "or add the products to this supplier"
            )
        covered = "; ".join(
            f"{p.name} on {', '.join(dict.fromkeys(covering.get(p.id, [])))}" for p in mine
        )
        raise InvalidRequestError(
            f"nothing needs reordering: every low-stock product is already on an open order ({covered}). "
            "Issue or receive those orders, or cancel one to draft it again"
        )
    order_id = _insert_order(
        conn, ws, actor, data.supplier_id, data.order_date or date.today(), None,
        "Drafted from low stock and recent use.", lines,
    )
    return get_order(conn, ws, order_id)


# ---- receiving against an order -----------------------------------------------------------------


def outstanding_for_receiving(conn: psycopg.Connection, ws: int, order_id: int) -> PurchaseOrder:
    """Lock an order for receiving and check it can take goods. Call inside a transaction."""
    order = get_order(conn, ws, order_id, lock=True)
    if order.status != "issued":
        raise InvalidRequestError(f"{order.reference} is {order.status}: only an issued purchase order can be received")
    if order.receiving_status == "fully_received":
        raise InvalidRequestError(f"{order.reference} is already fully received")
    return order
