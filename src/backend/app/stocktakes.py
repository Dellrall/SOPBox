"""Blind stock-count sheets and auditable stocktake adjustments."""

import csv
import io
import zipfile
from datetime import datetime, timezone
from typing import Any

import psycopg
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

from app.auditlog import audit
from app.errors import ConflictError, InvalidRequestError, NotFoundError
from app.models import StocktakeCreateIn, StocktakeDetail, StocktakeLineOut, StocktakeOut

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_WORKBOOK_BYTES = 25 * 1024 * 1024
MAX_UPLOAD_ROWS = 5000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _products(conn: psycopg.Connection, workspace_id: int) -> list[dict[str, Any]]:
    return conn.execute(
        "SELECT p.id, p.name, c.name AS category, p.base_unit, p.stock "
        "FROM products p JOIN categories c ON c.id = p.category_id "
        "WHERE p.workspace_id = %s AND NOT p.archived ORDER BY lower(p.name)",
        (workspace_id,),
    ).fetchall()


def build_template(conn: psycopg.Connection, workspace_id: int) -> bytes:
    """Return a blind-count workbook: product identity is prefilled, quantities are not."""
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Count sheet"
    instructions = workbook.create_sheet("Instructions")
    products = _products(conn, workspace_id)

    headers = ["Product ID", "Product Name", "Category", "Counted Stock", "Base Unit"]
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="174C3C")
        cell.alignment = Alignment(vertical="center")
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = f"A1:E{max(1, len(products) + 1)}"
    for column, width in {"A": 14, "B": 34, "C": 22, "D": 18, "E": 16}.items():
        sheet.column_dimensions[column].width = width

    for product in products:
        sheet.append([product["id"], product["name"], product["category"], None, product["base_unit"]])
        # Treat names/categories as text even if a value begins with a formula character.
        for cell in sheet[sheet.max_row][1:3]:
            cell.data_type = "s"

    instructions.title = "Instructions"
    instructions.append(["Stock Count Instructions"])
    instructions.append(["1. Count one total quantity per product, using its Base Unit."])
    instructions.append(["2. Enter physical quantities in Counted Stock."])
    instructions.append(["3. Leave a quantity blank if the product was not counted."])
    instructions.append(["4. Enter 0 only when you counted the product and confirmed none is on hand."])
    instructions.append(["5. Do not change Product ID or add duplicate product rows."])
    instructions.append(["6. Upload this workbook in Stock Count, review the counts, then save the stocktake."])
    instructions.column_dimensions["A"].width = 100
    instructions["A1"].font = Font(bold=True, size=14, color="174C3C")
    for row in range(2, instructions.max_row + 1):
        instructions.cell(row, 1).alignment = Alignment(wrap_text=True, vertical="top")

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def _rows_from_csv(content: bytes) -> tuple[list[str], list[tuple[int, list[Any]]]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise InvalidRequestError("CSV must be UTF-8 encoded") from exc
    reader = csv.reader(io.StringIO(text))
    try:
        rows = list(reader)
    except csv.Error as exc:
        raise InvalidRequestError("the uploaded CSV is not valid") from exc
    if not rows:
        raise InvalidRequestError("the uploaded count sheet is empty")
    return rows[0], [(index + 2, row) for index, row in enumerate(rows[1:])]


def _rows_from_xlsx(content: bytes) -> tuple[list[str], list[tuple[int, list[Any]]]]:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > 1000 or sum(item.file_size for item in entries) > MAX_WORKBOOK_BYTES:
                raise InvalidRequestError("the workbook is too large to process")
        workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except InvalidRequestError:
        raise
    except (zipfile.BadZipFile, OSError, ValueError, KeyError) as exc:
        raise InvalidRequestError("the uploaded file is not a valid Excel workbook") from exc

    sheet = workbook["Count sheet"] if "Count sheet" in workbook.sheetnames else workbook.active
    iterator = sheet.iter_rows(values_only=True)
    try:
        headers = list(next(iterator))
    except StopIteration as exc:
        raise InvalidRequestError("the uploaded count sheet is empty") from exc
    rows = [(index, list(row)) for index, row in enumerate(iterator, start=2)]
    workbook.close()
    return headers, rows


def _header_indexes(headers: list[Any]) -> tuple[int, int]:
    normalized = {
        str(value or "").strip().casefold().replace("_", " ").replace("-", " "): index
        for index, value in enumerate(headers)
    }
    id_index = next(
        (normalized[name] for name in ("product id", "id") if name in normalized), None
    )
    count_index = next(
        (
            normalized[name]
            for name in ("counted stock", "counted quantity", "physical count", "quantity")
            if name in normalized
        ),
        None,
    )
    if id_index is None or count_index is None:
        raise InvalidRequestError(
            "the count sheet needs Product ID and Counted Stock columns"
        )
    return id_index, count_index


def _number(value: Any, *, field: str, row_number: int) -> int:
    try:
        if isinstance(value, bool):
            raise ValueError
        if isinstance(value, float):
            if not value.is_integer():
                raise ValueError
            result = int(value)
        else:
            text = str(value).strip()
            if not text or not text.isdecimal():
                raise ValueError
            result = int(text)
        if result < 0 or result > 9_007_199_254_740_991:
            raise ValueError
        return result
    except (TypeError, ValueError) as exc:
        raise InvalidRequestError(
            f"row {row_number}: {field} must be a whole number of 0 or more"
        ) from exc


def preview_import(
    conn: psycopg.Connection, workspace_id: int, filename: str, content: bytes
) -> list[dict[str, Any]]:
    if not content or len(content) > MAX_UPLOAD_BYTES:
        raise InvalidRequestError("upload a non-empty file smaller than 5 MB")
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix == "csv":
        headers, rows = _rows_from_csv(content)
    elif suffix == "xlsx":
        headers, rows = _rows_from_xlsx(content)
    else:
        raise InvalidRequestError("upload an .xlsx or .csv count sheet")
    if len(rows) > MAX_UPLOAD_ROWS:
        raise InvalidRequestError("the count sheet contains too many rows")

    id_index, count_index = _header_indexes(headers)
    products = {int(p["id"]): p for p in _products(conn, workspace_id)}
    counted: list[dict[str, Any]] = []
    seen: set[int] = set()
    for row_number, row in rows:
        if len(row) <= max(id_index, count_index):
            continue
        raw_count = row[count_index]
        if raw_count is None or (isinstance(raw_count, str) and not raw_count.strip()):
            continue  # blank is deliberately different from an explicit zero
        product_id = _number(row[id_index], field="Product ID", row_number=row_number)
        if product_id in seen:
            raise InvalidRequestError(f"row {row_number}: product {product_id} appears more than once")
        seen.add(product_id)
        product = products.get(product_id)
        if product is None:
            raise InvalidRequestError(
                f"row {row_number}: product {product_id} is not active in this workspace"
            )
        quantity = _number(raw_count, field="Counted Stock", row_number=row_number)
        counted.append(
            {
                "product_id": product_id,
                "product_name": product["name"],
                "base_unit": product["base_unit"],
                "expected_stock": int(product["stock"]),
                "counted_stock": quantity,
                "difference": quantity - int(product["stock"]),
            }
        )
    if not counted:
        raise InvalidRequestError("no product counts were entered; blank rows are left unchanged")
    return counted


def _summary(row: dict[str, Any]) -> StocktakeOut:
    return StocktakeOut(
        id=row["id"],
        reference=row["reference"],
        count_date=row["count_date"],
        counted_by=row["counted_by"],
        created_at=row["created_at"],
        notes=row["notes"],
        line_count=row["line_count"],
        changed_count=row["changed_count"],
    )


_SUMMARY_SQL = """
SELECT s.id, s.reference, s.count_date, s.counted_by, s.created_at, s.notes,
       COUNT(l.id)::int AS line_count,
       COUNT(l.id) FILTER (WHERE l.difference <> 0)::int AS changed_count
FROM stocktakes s
LEFT JOIN stocktake_lines l ON l.stocktake_id = s.id
"""


def list_stocktakes(conn: psycopg.Connection, workspace_id: int) -> list[StocktakeOut]:
    rows = conn.execute(
        _SUMMARY_SQL
        + " WHERE s.workspace_id = %s GROUP BY s.id "
        "ORDER BY s.count_date DESC, s.id DESC LIMIT 200",
        (workspace_id,),
    ).fetchall()
    return [_summary(row) for row in rows]


def get_stocktake(
    conn: psycopg.Connection, workspace_id: int, stocktake_id: int
) -> StocktakeDetail:
    header = conn.execute(
        _SUMMARY_SQL
        + " WHERE s.workspace_id = %s AND s.id = %s GROUP BY s.id",
        (workspace_id, stocktake_id),
    ).fetchone()
    if header is None:
        raise NotFoundError("stocktake not found")
    rows = conn.execute(
        "SELECT id, product_id, product_name, base_unit, expected_stock, counted_stock, difference "
        "FROM stocktake_lines WHERE stocktake_id = %s ORDER BY lower(product_name)",
        (stocktake_id,),
    ).fetchall()
    return StocktakeDetail(
        **_summary(header).model_dump(),
        lines=[StocktakeLineOut(**row) for row in rows],
    )


def create_stocktake(
    conn: psycopg.Connection,
    workspace_id: int,
    counted_by: str,
    data: StocktakeCreateIn,
) -> StocktakeDetail:
    product_ids = [line.product_id for line in data.lines]
    with conn.transaction():
        # Serialize reference allocation within this workspace and lock product rows before
        # comparing the expected balances submitted by the counter.
        workspace = conn.execute(
            "SELECT id FROM workspaces WHERE id = %s FOR UPDATE", (workspace_id,)
        ).fetchone()
        if workspace is None:
            raise NotFoundError("workspace not found")
        products = conn.execute(
            "SELECT id, name, base_unit, stock FROM products "
            "WHERE workspace_id = %s AND NOT archived AND id = ANY(%s) "
            "ORDER BY id FOR UPDATE",
            (workspace_id, product_ids),
        ).fetchall()
        by_id = {int(product["id"]): product for product in products}
        if set(by_id) != set(product_ids):
            raise InvalidRequestError("one or more products are no longer active")

        for line in data.lines:
            product = by_id[line.product_id]
            if int(product["stock"]) != line.expected_stock:
                raise ConflictError(
                    f"{product['name']} stock changed while the count was open; reload and review it"
                )

        number = conn.execute(
            "SELECT COALESCE(MAX(number), 0) + 1 AS next_number "
            "FROM stocktakes WHERE workspace_id = %s",
            (workspace_id,),
        ).fetchone()["next_number"]
        reference = f"ST-{number:06d}"
        created_at = _now()
        stocktake_id = conn.execute(
            "INSERT INTO stocktakes "
            "(workspace_id, number, reference, count_date, counted_by, created_at, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                workspace_id,
                number,
                reference,
                data.count_date,
                counted_by,
                created_at,
                data.notes.strip(),
            ),
        ).fetchone()["id"]

        changed_count = 0
        for line in data.lines:
            product = by_id[line.product_id]
            expected = int(product["stock"])
            difference = line.counted_stock - expected
            changed_count += difference != 0
            conn.execute(
                "INSERT INTO stocktake_lines "
                "(stocktake_id, product_id, product_name, base_unit, expected_stock, counted_stock, difference) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    stocktake_id,
                    line.product_id,
                    product["name"],
                    product["base_unit"],
                    expected,
                    line.counted_stock,
                    difference,
                ),
            )
            conn.execute(
                "UPDATE products SET stock = %s WHERE id = %s AND workspace_id = %s",
                (line.counted_stock, line.product_id, workspace_id),
            )

        audit(
            conn,
            workspace_id,
            counted_by,
            "stocktake.created",
            None,
            f"{reference}: {len(data.lines)} products counted; {changed_count} stock balances changed.",
        )

    return get_stocktake(conn, workspace_id, stocktake_id)
