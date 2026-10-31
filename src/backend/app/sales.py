"""Uploaded sales: a sheet of product codes and quantities sold, taken off one storage area's stock.

Taking sales off stock means the next count's difference is only what sales do not explain:
waste, theft or a receiving mistake. More sold than the storage area held takes it to 0, and the
sale keeps both numbers so the gap stays visible.
"""

import csv
import io
from datetime import datetime, timezone
from typing import Any

import psycopg

from app import locations, stocktakes
from app.auditlog import audit
from app.errors import InvalidRequestError
from app.models import SaleIn, SaleLineOut, SaleOut, SalePreview, SalePreviewLine

# Header names a sales sheet or POS export may use, compared after stocktakes._norm.
_CODE = ("product code", "code", "sku", "product no", "product number", "item code", "item no", "barcode")
_QUANTITY = ("quantity sold", "qty sold", "sold", "quantity", "qty")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _columns(row: list[Any]) -> tuple[int, int] | None:
    names = {stocktakes._norm(value): index for index, value in enumerate(row)}
    code = next((names[n] for n in _CODE if n in names), None)
    quantity = next((names[n] for n in _QUANTITY if n in names), None)
    return None if code is None or quantity is None else (code, quantity)


def _code_text(value: Any) -> str:
    """Excel turns a numeric code into 1001.0; read it back as "1001"."""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def match(
    conn: psycopg.Connection, ws: int, storage_id: int, sold: dict[str, tuple[str, int]]
) -> tuple[list[SalePreviewLine], list[str]]:
    """Each casefolded code's product and quantity, and the codes no active product has."""
    products = {
        r["code"].casefold(): r
        for r in conn.execute(
            "SELECT p.id, p.code, p.name, p.base_unit, COALESCE(l.quantity, 0) AS in_stock FROM products p "
            "LEFT JOIN stock_levels l ON l.product_id = p.id AND l.storage_id = %s "
            "WHERE p.workspace_id = %s AND NOT p.archived AND p.code IS NOT NULL",
            (storage_id, ws),
        ).fetchall()
    }
    lines, unknown = [], []
    for key, (code, quantity) in sold.items():
        product = products.get(key)
        if product is None:
            unknown.append(code)
        elif quantity > 0:
            lines.append(SalePreviewLine(
                product_id=product["id"], code=product["code"], product_name=product["name"],
                base_unit=product["base_unit"], quantity=quantity, in_stock=product["in_stock"],
            ))
    return lines, unknown


def preview(conn: psycopg.Connection, ws: int, storage_id: int, filename: str, content: bytes) -> SalePreview:
    """Match each row's code to a product and add up repeated codes. Nothing is saved."""
    storage_id = locations.resolve(conn, ws, storage_id)
    if not content or len(content) > stocktakes.MAX_UPLOAD_BYTES:
        raise InvalidRequestError("upload a non-empty file smaller than 5 MB")
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix == "csv":
        rows = stocktakes._rows_from_csv(content)
    elif suffix == "xlsx":
        rows = stocktakes._rows_from_xlsx(content)
    else:
        raise InvalidRequestError("upload an .xlsx or .csv sales sheet")
    if len(rows) > stocktakes.MAX_UPLOAD_ROWS:
        raise InvalidRequestError("the sales sheet contains too many rows")

    columns = None
    sold: dict[str, tuple[str, int]] = {}  # casefolded code: (code as first written, quantity)
    for row_number, row in rows:
        if columns is None:
            columns = _columns(row)
            continue
        code_at, quantity_at = columns
        code = _code_text(row[code_at]) if code_at < len(row) and not stocktakes._blank(row[code_at]) else ""
        raw = row[quantity_at] if quantity_at < len(row) else None
        if not code or stocktakes._blank(raw):
            continue
        quantity = stocktakes._number(raw, field="Quantity", row_number=row_number)
        written, total = sold.get(code.casefold(), (code, 0))
        sold[code.casefold()] = (written, total + quantity)
    if columns is None:
        raise InvalidRequestError("the sheet needs a Product code column and a Quantity column")

    lines, unknown = match(conn, ws, storage_id, sold)
    if not lines and not unknown:
        raise InvalidRequestError("no sales were found in the sheet")
    return SalePreview(lines=sorted(lines, key=lambda line: line.product_name.casefold()), unknown_codes=sorted(unknown))


def _sales(conn: psycopg.Connection, ws: int, where: str, params: tuple) -> list[SaleOut]:
    rows = conn.execute(
        f"SELECT x.*, {locations.LABEL_SQL} AS label FROM sales x "
        "JOIN storages s ON s.id = x.storage_id JOIN outlets o ON o.id = s.outlet_id "
        f"WHERE x.workspace_id = %s {where} ORDER BY x.sale_date DESC, x.id DESC LIMIT 50",
        (ws, *params),
    ).fetchall()
    lines = conn.execute(
        "SELECT sale_id, product_id, product_code, product_name, base_unit, quantity, deducted "
        "FROM sale_lines WHERE sale_id = ANY(%s) ORDER BY lower(product_name)",
        ([r["id"] for r in rows],),
    ).fetchall()
    return [
        SaleOut(
            id=r["id"], reference=f"SA-{r['number']:06d}", storage=r["label"], sale_date=r["sale_date"],
            source=r["source"], recorded_by=r["recorded_by"], created_at=r["created_at"],
            lines=[SaleLineOut(**{k: v for k, v in line.items() if k != "sale_id"})
                   for line in lines if line["sale_id"] == r["id"]],
        )
        for r in rows
    ]


def list_sales(conn: psycopg.Connection, ws: int) -> list[SaleOut]:
    return _sales(conn, ws, f"AND {locations.mine('x.storage_id')}", ())


def create_sale(
    conn: psycopg.Connection, ws: int, by: str, data: SaleIn, external_ref: str | None = None
) -> SaleOut:
    """Record a sale. A sale with an external_ref already on record is returned unchanged."""
    storage_id = locations.resolve(conn, ws, data.storage_id)
    product_ids = [line.product_id for line in data.lines]
    with conn.transaction():
        conn.execute("SELECT id FROM workspaces WHERE id = %s FOR UPDATE", (ws,))  # numbers in order
        if external_ref is not None:
            sent = conn.execute(
                "SELECT id FROM sales WHERE workspace_id = %s AND external_ref = %s", (ws, external_ref)
            ).fetchone()
            if sent is not None:
                return _sales(conn, ws, "AND x.id = %s", (sent["id"],))[0]
        products = {
            r["id"]: r
            for r in conn.execute(
                "SELECT id, code, name, base_unit FROM products WHERE workspace_id = %s AND NOT archived "
                "AND id = ANY(%s) ORDER BY id FOR UPDATE",
                (ws, product_ids),
            ).fetchall()
        }
        if set(products) != set(product_ids):
            raise InvalidRequestError("one or more products are unknown or archived")
        have = locations.levels(conn, storage_id, product_ids)
        number = conn.execute(
            "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM sales WHERE workspace_id = %s", (ws,)
        ).fetchone()["n"]
        sale_id = conn.execute(
            "INSERT INTO sales (workspace_id, number, storage_id, sale_date, source, recorded_by, created_at, "
            "external_ref) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (ws, number, storage_id, data.sale_date, data.source, by, _now(), external_ref),
        ).fetchone()["id"]
        short = 0
        for line in data.lines:
            product = products[line.product_id]
            deducted = min(line.quantity, have[line.product_id])
            short += deducted < line.quantity
            conn.execute(
                "INSERT INTO sale_lines (sale_id, product_id, product_code, product_name, base_unit, quantity, "
                "deducted) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (sale_id, line.product_id, product["code"] or "", product["name"], product["base_unit"],
                 line.quantity, deducted),
            )
            locations.adjust(conn, ws, line.product_id, storage_id, -deducted)
        audit(
            conn, ws, by, "sales.recorded", None,
            f"SA-{number:06d}: {len(data.lines)} product(s) sold from {locations.storage_label(conn, ws, storage_id)}"
            + (f"; {short} sold more than was in stock" if short else ""),
        )
    return _sales(conn, ws, "AND x.id = %s", (sale_id,))[0]


def _cell(text: str) -> str:
    """Keep a spreadsheet from running a name as a formula."""
    return f"'{text}" if text[:1] in ("=", "+", "-", "@") else text


def template_csv(conn: psycopg.Connection, ws: int) -> bytes:
    """Every active product that has a code, with Quantity left for the day's sales."""
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Product code", "Product name", "Quantity"])
    for r in conn.execute(
        "SELECT code, name FROM products WHERE workspace_id = %s AND NOT archived AND code IS NOT NULL "
        "ORDER BY lower(name)",
        (ws,),
    ).fetchall():
        writer.writerow([_cell(r["code"]), _cell(r["name"]), ""])
    return out.getvalue().encode("utf-8-sig")
