"""Reports: the records the app already keeps, filtered by period, product, supplier and storage area,
with totals worked out here. Each report is one SQL query over the outlet worked in (locations.mine),
so a report never shows another outlet's records. Nothing is saved; the page prints or downloads it.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

import psycopg

from app import insights, locations, lots
from app.errors import InvalidRequestError
from app.models import ReportColumn, ReportFilter, ReportKind, ReportOut

_LOC = f"{locations.LABEL_SQL}"  # "Outlet / Storage area", needs storages s and outlets o


@dataclass(frozen=True)
class _Report:
    title: str
    columns: list[tuple[str, str, str]]  # key, label, kind: text, number, money (sen), date
    sql: str  # with {where}; the first parameter is the workspace id
    day: str | None  # the column the period filters on
    product: str | None
    supplier: str | None
    storage: str | None
    outlet: str  # SQL limiting rows to the outlet worked in
    order: str
    totals: tuple[str, ...] = ()  # columns added up for the total row


_DELIVERY_FROM = (
    "FROM delivery_lines l JOIN deliveries d ON d.id = l.delivery_id "
    "LEFT JOIN products p ON p.id = l.product_id "
    "LEFT JOIN purchase_orders po ON po.id = d.purchase_order_id "
    "LEFT JOIN storages s ON s.id = d.storage_id LEFT JOIN outlets o ON o.id = s.outlet_id "
    "WHERE d.workspace_id = %s {where}"
)
_DELIVERY_DAY = "left(d.created_at, 10)::date"
_SUPPLIER = "lower(d.supplier)"

REPORTS: dict[str, _Report] = {
    "deliveries": _Report(
        "Deliveries, line by line",
        [("day", "Date", "date"), ("delivery", "Delivery", "text"), ("supplier", "Supplier", "text"),
         ("po", "PO", "text"), ("product", "Product", "text"), ("quantity", "Qty", "number"), ("unit", "Unit", "text"),
         ("price", "Unit price", "money"), ("value", "Value", "money"), ("result", "Check", "text"),
         ("issues", "Issues", "text"), ("expiry", "Expiry", "date"), ("status", "Delivery status", "text"),
         ("location", "Received at", "text")],
        "SELECT " + _DELIVERY_DAY + " AS day, 'DO #' || d.id AS delivery, d.supplier, "
        "CASE WHEN po.number IS NULL THEN '' ELSE 'PO-' || lpad(po.number::text, 4, '0') END AS po, "
        "l.name AS product, l.quantity, l.unit, l.unit_price_sen AS price, l.quantity * l.unit_price_sen AS value, "
        "CASE WHEN l.returned THEN 'Returned' WHEN l.passed THEN 'Passed' ELSE 'Failed' END AS result, "
        "COALESCE((SELECT string_agg(x, '; ') FROM json_array_elements_text(l.issues::json) x), '') AS issues, "
        "l.expiry_on AS expiry, replace(d.status, '_', ' ') AS status, COALESCE(" + _LOC + ", '') AS location "
        + _DELIVERY_FROM,
        _DELIVERY_DAY, "l.product_id", _SUPPLIER, "d.storage_id", locations.mine("d.storage_id"),
        "d.created_at DESC, d.id DESC, l.id", ("value",),
    ),
    "spend": _Report(
        "Spending by supplier and product",
        [("supplier", "Supplier", "text"), ("product", "Product", "text"), ("deliveries", "Deliveries", "number"),
         ("received", "Received", "number"), ("unit", "Unit", "text"), ("value", "Spent", "money"),
         ("per_unit", "Average per unit", "money")],
        "SELECT d.supplier, COALESCE(p.name, l.name) AS product, count(DISTINCT d.id) AS deliveries, "
        "sum(COALESCE(l.received_base_qty, l.quantity)) AS received, COALESCE(p.base_unit, min(l.unit)) AS unit, "
        "sum(l.quantity * l.unit_price_sen) AS value, "
        "round(sum(l.quantity * l.unit_price_sen)::numeric / NULLIF(sum(CASE WHEN l.unit_price_sen IS NOT NULL "
        "THEN COALESCE(l.received_base_qty, l.quantity) END), 0)) AS per_unit "
        + _DELIVERY_FROM.replace("{where}", "AND d.status = 'accepted' AND NOT l.returned {where}")
        + " GROUP BY d.supplier, COALESCE(p.name, l.name), p.base_unit",
        _DELIVERY_DAY, "l.product_id", _SUPPLIER, "d.storage_id", locations.mine("d.storage_id"),
        "value DESC NULLS LAST, supplier, product", ("deliveries", "value"),
    ),
    "suppliers": _Report(
        "Supplier checks",
        [("supplier", "Supplier", "text"), ("deliveries", "Deliveries", "number"), ("lines", "Lines", "number"),
         ("failed", "Failed checks", "number"), ("returned", "Lines returned", "number"),
         ("rejected", "Deliveries rejected or returned", "number"), ("passed_pct", "Passed %", "number"),
         ("value", "Spent", "money")],
        "SELECT d.supplier, count(DISTINCT d.id) AS deliveries, count(*) AS lines, "
        "count(*) FILTER (WHERE NOT l.passed) AS failed, count(*) FILTER (WHERE l.returned) AS returned, "
        "count(DISTINCT d.id) FILTER (WHERE d.status IN ('rejected', 'returned')) AS rejected, "
        "round(100.0 * count(*) FILTER (WHERE l.passed) / count(*)) AS passed_pct, "
        "sum(l.quantity * l.unit_price_sen) FILTER (WHERE d.status = 'accepted' AND NOT l.returned) AS value "
        + _DELIVERY_FROM + " GROUP BY d.supplier",
        _DELIVERY_DAY, "l.product_id", _SUPPLIER, "d.storage_id", locations.mine("d.storage_id"),
        "failed DESC, supplier", ("deliveries", "lines", "failed", "returned", "rejected", "value"),
    ),
    "orders": _Report(
        "Purchase orders and what arrived",
        [("day", "Order date", "date"), ("po", "PO", "text"), ("supplier", "Supplier", "text"),
         ("status", "Status", "text"), ("product", "Product", "text"), ("ordered", "Ordered", "number"),
         ("received", "Received", "number"), ("outstanding", "Still to come", "number"), ("unit", "Unit", "text"),
         ("expected", "Expected", "date")],
        "SELECT po.order_date::date AS day, 'PO-' || lpad(po.number::text, 4, '0') AS po, su.name AS supplier, "
        "po.status, p.name AS product, pl.ordered_base_qty AS ordered, COALESCE(r.received, 0) AS received, "
        "greatest(pl.ordered_base_qty - COALESCE(r.received, 0), 0) AS outstanding, p.base_unit AS unit, "
        "NULLIF(po.expected_date, '')::date AS expected "
        "FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.purchase_order_id "
        "JOIN suppliers su ON su.id = po.supplier_id JOIN products p ON p.id = pl.product_id "
        "LEFT JOIN (SELECT d.purchase_order_id, l.product_id, sum(l.received_base_qty) AS received "
        "FROM deliveries d JOIN delivery_lines l ON l.delivery_id = d.id "
        "WHERE d.status = 'accepted' AND NOT l.returned GROUP BY 1, 2) r "
        "ON r.purchase_order_id = po.id AND r.product_id = pl.product_id "
        "WHERE po.workspace_id = %s {where}",
        "po.order_date::date", "pl.product_id", "lower(su.name)", None, locations.at_outlet("po.outlet_id"),
        "po.number DESC, p.name", ("ordered", "received", "outstanding"),
    ),
    "sales": _Report(
        "Sales, line by line",
        [("day", "Sale date", "date"), ("sale", "Sale", "text"), ("location", "Sold from", "text"),
         ("product", "Product", "text"), ("code", "Code", "text"), ("sold", "Sold", "number"),
         ("deducted", "Taken off stock", "number"), ("short", "Short", "number"), ("unit", "Unit", "text"),
         ("source", "Source", "text")],
        "SELECT x.sale_date AS day, 'SA-' || lpad(x.number::text, 6, '0') AS sale, " + _LOC + " AS location, "
        "sl.product_name AS product, sl.product_code AS code, sl.quantity AS sold, sl.deducted, "
        "sl.quantity - sl.deducted AS short, sl.base_unit AS unit, x.source "
        "FROM sale_lines sl JOIN sales x ON x.id = sl.sale_id JOIN storages s ON s.id = x.storage_id "
        "JOIN outlets o ON o.id = s.outlet_id WHERE x.workspace_id = %s {where}",
        "x.sale_date", "sl.product_id", None, "x.storage_id", locations.mine("x.storage_id"),
        "x.sale_date DESC, x.number DESC, sl.product_name", ("sold", "deducted", "short"),
    ),
    "sales_by_product": _Report(
        "Sales by product",
        [("product", "Product", "text"), ("sold", "Sold", "number"), ("unit", "Unit", "text"),
         ("days", "Days with sales", "number"), ("per_day", "Average a day", "number"),
         ("short", "Sold beyond stock", "number")],
        "SELECT sl.product_name AS product, sum(sl.quantity) AS sold, sl.base_unit AS unit, "
        "count(DISTINCT x.sale_date) AS days, round(sum(sl.quantity)::numeric / count(DISTINCT x.sale_date), 1) AS per_day, "
        "sum(sl.quantity - sl.deducted) AS short "
        "FROM sale_lines sl JOIN sales x ON x.id = sl.sale_id WHERE x.workspace_id = %s {where} "
        "GROUP BY sl.product_name, sl.base_unit",
        "x.sale_date", "sl.product_id", None, "x.storage_id", locations.mine("x.storage_id"),
        "sold DESC, product", ("sold", "short"),
    ),
    "counts": _Report(
        "Stock counts and gaps",
        [("day", "Count date", "date"), ("count", "Count", "text"), ("location", "Where", "text"),
         ("product", "Product", "text"), ("expected", "Expected", "number"), ("counted", "Counted", "number"),
         ("difference", "Difference", "number"), ("unit", "Unit", "text"), ("value", "Value of difference", "money")],
        "SELECT t.count_date AS day, t.reference AS count, COALESCE(" + _LOC + ", '') AS location, "
        "tl.product_name AS product, tl.expected_stock AS expected, tl.counted_stock AS counted, tl.difference, "
        "tl.base_unit AS unit, tl.product_id "
        "FROM stocktake_lines tl JOIN stocktakes t ON t.id = tl.stocktake_id "
        "LEFT JOIN storages s ON s.id = t.storage_id LEFT JOIN outlets o ON o.id = s.outlet_id "
        "WHERE t.workspace_id = %s {where}",
        "t.count_date", "tl.product_id", None, "t.storage_id", locations.mine("t.storage_id"),
        "t.count_date DESC, t.number DESC, tl.product_name", ("difference", "value"),
    ),
    "transfers": _Report(
        "Transfers",
        [("day", "Date", "date"), ("transfer", "Transfer", "text"), ("from_place", "From", "text"), ("to_place", "To", "text"),
         ("product", "Product", "text"), ("quantity", "Qty", "number"), ("unit", "Unit", "text"), ("moved_by", "Moved by", "text")],
        "SELECT left(t.created_at, 10)::date AS day, 'TR-' || lpad(t.number::text, 6, '0') AS transfer, "
        "(fo.name || ' / ' || fs.name) AS from_place, (tou.name || ' / ' || ts.name) AS to_place, tl.product_name AS product, "
        "tl.quantity, tl.base_unit AS unit, t.moved_by "
        "FROM stock_transfer_lines tl JOIN stock_transfers t ON t.id = tl.transfer_id "
        "JOIN storages fs ON fs.id = t.from_storage_id JOIN outlets fo ON fo.id = fs.outlet_id "
        "JOIN storages ts ON ts.id = t.to_storage_id JOIN outlets tou ON tou.id = ts.outlet_id "
        "WHERE t.workspace_id = %s {where}",
        "left(t.created_at, 10)::date", "tl.product_id", None, "t.from_storage_id",
        f"({locations.mine('t.from_storage_id')} OR {locations.mine('t.to_storage_id')})",
        "t.created_at DESC, t.number DESC, tl.product_name", ("quantity",),
    ),
    "waste": _Report(
        "Waste and disposals",
        [("day", "Date", "date"), ("product", "Product", "text"), ("location", "Where", "text"),
         ("quantity", "Qty", "number"), ("unit", "Unit", "text"), ("method", "How", "text"),
         ("value", "Value", "money"), ("disposed_by", "By", "text"), ("notes", "Note", "text")],
        "SELECT left(w.created_at, 10)::date AS day, COALESCE(p.name, 'Removed product') AS product, "
        + _LOC + " AS location, w.quantity, COALESCE(p.base_unit, '') AS unit, replace(w.method, '_', ' ') AS method, "
        "w.value_sen AS value, w.disposed_by, w.notes "
        "FROM stock_disposals w LEFT JOIN products p ON p.id = w.product_id "
        "JOIN storages s ON s.id = w.storage_id JOIN outlets o ON o.id = s.outlet_id WHERE w.workspace_id = %s {where}",
        "left(w.created_at, 10)::date", "w.product_id", None, "w.storage_id", locations.mine("w.storage_id"),
        "w.created_at DESC", ("quantity", "value"),
    ),
    "stock": _Report(
        "Stock on hand",
        [("location", "Where", "text"), ("category", "Category", "text"), ("product", "Product", "text"),
         ("quantity", "In stock", "number"), ("unit", "Unit", "text"), ("min_stock", "Minimum", "number"),
         ("value", "Value", "money")],
        "SELECT " + _LOC + " AS location, COALESCE(c.name, '') AS category, p.name AS product, sl.quantity, "
        "p.base_unit AS unit, p.min_stock, p.id AS product_id "
        "FROM stock_levels sl JOIN products p ON p.id = sl.product_id LEFT JOIN categories c ON c.id = p.category_id "
        "JOIN storages s ON s.id = sl.storage_id JOIN outlets o ON o.id = s.outlet_id "
        "WHERE sl.workspace_id = %s AND NOT p.archived {where}",
        None, "sl.product_id", None, "sl.storage_id", locations.mine("sl.storage_id"),
        "location, category, product", ("value",),
    ),
    "movement": _Report(
        "Stock movement by product",
        [("product", "Product", "text"), ("unit", "Unit", "text"), ("received", "Received", "number"),
         ("sold", "Sold", "number"), ("moved_in", "Moved in", "number"), ("moved_out", "Moved out", "number"),
         ("disposed", "Disposed", "number"), ("count_change", "Count changes", "number"), ("net", "Net change", "number")],
        "SELECT p.name AS product, p.base_unit AS unit, sum(m.received) AS received, sum(m.sold) AS sold, "
        "sum(m.moved_in) AS moved_in, sum(m.moved_out) AS moved_out, sum(m.disposed) AS disposed, "
        "sum(m.count_change) AS count_change, "
        "sum(m.received - m.sold + m.moved_in - m.moved_out - m.disposed + m.count_change) AS net "
        "FROM ("
        "SELECT l.product_id, d.storage_id, " + _DELIVERY_DAY + " AS day, l.received_base_qty AS received, "
        "0 AS sold, 0 AS moved_in, 0 AS moved_out, 0 AS disposed, 0 AS count_change "
        "FROM delivery_lines l JOIN deliveries d ON d.id = l.delivery_id "
        "WHERE d.workspace_id = %s AND d.status = 'accepted' AND NOT l.returned AND l.received_base_qty IS NOT NULL "
        "UNION ALL SELECT sl.product_id, x.storage_id, x.sale_date, 0, sl.deducted, 0, 0, 0, 0 "
        "FROM sale_lines sl JOIN sales x ON x.id = sl.sale_id "
        "UNION ALL SELECT tl.product_id, t.to_storage_id, left(t.created_at, 10)::date, 0, 0, tl.quantity, 0, 0, 0 "
        "FROM stock_transfer_lines tl JOIN stock_transfers t ON t.id = tl.transfer_id "
        "UNION ALL SELECT tl.product_id, t.from_storage_id, left(t.created_at, 10)::date, 0, 0, 0, tl.quantity, 0, 0 "
        "FROM stock_transfer_lines tl JOIN stock_transfers t ON t.id = tl.transfer_id "
        "UNION ALL SELECT w.product_id, w.storage_id, left(w.created_at, 10)::date, 0, 0, 0, 0, w.quantity, 0 "
        "FROM stock_disposals w "
        "UNION ALL SELECT tl.product_id, t.storage_id, t.count_date, 0, 0, 0, 0, 0, tl.difference "
        "FROM stocktake_lines tl JOIN stocktakes t ON t.id = tl.stocktake_id"
        ") m JOIN products p ON p.id = m.product_id WHERE p.workspace_id = %s {where} "
        "GROUP BY p.name, p.base_unit",
        "m.day", "m.product_id", None, "m.storage_id", locations.mine("m.storage_id"),
        "product", ("received", "sold", "moved_in", "moved_out", "disposed", "count_change", "net"),
    ),
}

EXPIRY_COLUMNS = [
    ("expiry", "Expires", "date"), ("status", "Status", "text"), ("product", "Product", "text"), ("lot", "Lot", "text"),
    ("left", "Left", "number"), ("unit", "Unit", "text"), ("location", "Where", "text"), ("supplier", "Supplier", "text"),
    ("po", "PO", "text"), ("received", "Received", "date"),
]
TITLES = {kind: r.title for kind, r in REPORTS.items()} | {"expiry": "Expiry dates"}
MAX_ROWS = 5000


def _value(rows: list[dict], conn: psycopg.Connection, ws: int, quantity: str) -> None:
    """Money worth of a quantity at each product's latest delivered price, worked out here."""
    prices = insights.latest_prices(conn, ws)
    for row in rows:
        price = prices.get(row.pop("product_id", None))
        row["value"] = None if price is None else round(row[quantity] * price)


def _expiry(conn: psycopg.Connection, ws: int, f: ReportFilter) -> list[dict]:
    rows = []
    for lot in lots.list_lots(conn, ws):
        when = lot.expiry_on
        if f.date_from and (when is None or when < f.date_from) or f.date_to and (when is None or when > f.date_to):
            continue
        if f.product_id and lot.product_id != f.product_id or f.storage_id and lot.storage_id != f.storage_id:
            continue
        if f.supplier and lot.supplier.casefold() != f.supplier.casefold():
            continue
        rows.append({
            "expiry": when, "status": lot.status, "product": lot.product, "lot": lot.code, "left": lot.left,
            "unit": lot.base_unit, "location": lot.location, "supplier": lot.supplier, "po": lot.purchase_order or "",
            "received": date.fromisoformat(lot.received_at[:10]),
        })
    return rows


def _plain(value):
    """Postgres sums come back as Decimal: whole numbers as int, the rest as float, for JSON."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


def build(conn: psycopg.Connection, ws: int, kind: ReportKind, f: ReportFilter) -> ReportOut:
    if f.date_from and f.date_to and f.date_from > f.date_to:
        raise InvalidRequestError("the period starts after it ends")
    if kind == "expiry":
        columns, rows, totals_of = EXPIRY_COLUMNS, _expiry(conn, ws, f), ("left",)
    else:
        r = REPORTS[kind]
        where, params = [r.outlet], []
        for value, sql in ((f.date_from, r.day and f"{r.day} >= %s"), (f.date_to, r.day and f"{r.day} <= %s"),
                           (f.product_id, r.product and f"{r.product} = %s"),
                           (f.supplier and f.supplier.casefold(), r.supplier and f"{r.supplier} = %s"),
                           (f.storage_id, r.storage and f"{r.storage} = %s")):
            if value is not None and value != "" and sql:
                where.append(sql)
                params.append(value)
        sql = r.sql.format(where="AND " + " AND ".join(where)) + f" ORDER BY {r.order} LIMIT {MAX_ROWS + 1}"
        rows = conn.execute(sql, (ws, *params) if kind != "movement" else (ws, ws, *params)).fetchall()
        if kind in ("counts", "stock"):
            _value(rows, conn, ws, "difference" if kind == "counts" else "quantity")
        columns, totals_of = r.columns, r.totals
    truncated = len(rows) > MAX_ROWS
    rows = rows[:MAX_ROWS]
    totals = {k: sum(row[k] or 0 for row in rows) for k in totals_of}
    return ReportOut(
        kind=kind, title=TITLES[kind], columns=[ReportColumn(key=k, label=label, kind=t) for k, label, t in columns],
        rows=[{k: _plain(row.get(k)) for k, _, _ in columns} for row in rows],
        totals={k: _plain(v) for k, v in totals.items()}, truncated=truncated,
        filters_used={"day": kind == "expiry" or REPORTS[kind].day is not None,
                      "product": True, "supplier": kind == "expiry" or REPORTS[kind].supplier is not None,
                      "storage": kind == "expiry" or REPORTS[kind].storage is not None},
    )
