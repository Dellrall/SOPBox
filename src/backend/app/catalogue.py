"""Categories and products: create, read, update, delete, and search (the SOP lookup).

Every function takes the caller's `workspace_id` and only touches that workspace's rows.
"""

import re
from collections import defaultdict

import psycopg

from app import plans
from app.errors import InvalidRequestError, NotFoundError
from app.models import Category, CategoryIn, PackUnit, Product, ProductIn

_PRODUCT_SELECT = """
SELECT p.*, c.name AS category, c.temp_min_c AS cat_min, c.temp_max_c AS cat_max
FROM products p JOIN categories c ON c.id = p.category_id
WHERE p.workspace_id = %s
"""


# ---- categories -------------------------------------------------------------------------------


def list_categories(conn: psycopg.Connection, ws: int) -> list[Category]:
    rows = conn.execute(
        "SELECT * FROM categories WHERE workspace_id = %s ORDER BY lower(name)", (ws,)
    ).fetchall()
    return [Category(**r) for r in rows]


def get_category(conn: psycopg.Connection, ws: int, category_id: int) -> Category:
    row = conn.execute(
        "SELECT * FROM categories WHERE id = %s AND workspace_id = %s", (category_id, ws)
    ).fetchone()
    if row is None:
        raise NotFoundError(f"category {category_id} not found")
    return Category(**row)


def create_category(conn: psycopg.Connection, ws: int, data: CategoryIn) -> Category:
    row = conn.execute(
        "INSERT INTO categories (workspace_id, name, temp_min_c, temp_max_c) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        (ws, data.name, data.temp_min_c, data.temp_max_c),
    ).fetchone()
    return get_category(conn, ws, row["id"])


def update_category(
    conn: psycopg.Connection, ws: int, category_id: int, data: CategoryIn
) -> Category:
    cur = conn.execute(
        "UPDATE categories SET name = %s, temp_min_c = %s, temp_max_c = %s "
        "WHERE id = %s AND workspace_id = %s",
        (data.name, data.temp_min_c, data.temp_max_c, category_id, ws),
    )
    if cur.rowcount == 0:
        raise NotFoundError(f"category {category_id} not found")
    return get_category(conn, ws, category_id)


def delete_category(conn: psycopg.Connection, ws: int, category_id: int) -> None:
    # A category that still has products is protected by the foreign key (HTTP 409).
    cur = conn.execute(
        "DELETE FROM categories WHERE id = %s AND workspace_id = %s", (category_id, ws)
    )
    if cur.rowcount == 0:
        raise NotFoundError(f"category {category_id} not found")


# ---- products ---------------------------------------------------------------------------------


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _load(conn: psycopg.Connection, ws: int, where: str = "", params: tuple = ()) -> list[Product]:
    rows = conn.execute(
        f"{_PRODUCT_SELECT} {where} ORDER BY lower(p.name)", (ws, *params)
    ).fetchall()
    packs: dict[int, list[PackUnit]] = defaultdict(list)
    ids = [r["id"] for r in rows]
    if ids:
        pack_rows = conn.execute(
            "SELECT product_id, unit, base_qty FROM pack_units "
            "WHERE product_id = ANY(%s) ORDER BY base_qty, unit",
            (ids,),
        )
        for p in pack_rows:
            packs[p["product_id"]].append(PackUnit(unit=p["unit"], base_qty=p["base_qty"]))

    products = []
    for r in rows:
        overridden = r["temp_min_c"] is not None
        low, high = (r["temp_min_c"], r["temp_max_c"]) if overridden else (r["cat_min"], r["cat_max"])
        products.append(
            Product(
                id=r["id"],
                name=r["name"],
                category_id=r["category_id"],
                category=r["category"],
                base_unit=r["base_unit"],
                temp_min_c=r["temp_min_c"],
                temp_max_c=r["temp_max_c"],
                effective_temp_min_c=low,
                effective_temp_max_c=high,
                min_stock=r["min_stock"],
                stock=r["stock"],
                sop=r["sop"],
                pack_units=packs.get(r["id"], []),
                # An archived product is not reordered, so it is never "low".
                low_stock=not r["archived"] and r["stock"] < r["min_stock"],
                archived=r["archived"],
                code=r["code"],
                barcode=r["barcode"],
                track_expiry=r["track_expiry"],
                min_days_left=r["min_days_left"],
                warn_days=r["warn_days"],
            )
        )
    return products


def list_products(
    conn: psycopg.Connection, ws: int, q: str | None = None, *, active_only: bool = False
) -> list[Product]:
    """All products, or those whose name, category or SOP text contains `q`."""
    if active_only:
        return _load(conn, ws, "AND NOT p.archived")
    if q and q.strip():
        like = f"%{_escape_like(q.strip())}%"
        where = (
            "AND (p.name ILIKE %s ESCAPE '\\' OR p.sop ILIKE %s ESCAPE '\\' "
            "OR c.name ILIKE %s ESCAPE '\\' OR p.code ILIKE %s ESCAPE '\\' OR p.barcode = %s)"
        )
        return _load(conn, ws, where, (like, like, like, like, q.strip()))
    return _load(conn, ws)


def get_product(conn: psycopg.Connection, ws: int, product_id: int) -> Product:
    found = _load(conn, ws, "AND p.id = %s", (product_id,))
    if not found:
        raise NotFoundError(f"product {product_id} not found")
    return found[0]


def _require_category(conn: psycopg.Connection, ws: int, category_id: int) -> None:
    row = conn.execute(
        "SELECT 1 FROM categories WHERE id = %s AND workspace_id = %s", (category_id, ws)
    ).fetchone()
    if row is None:
        raise InvalidRequestError(f"unknown category_id {category_id}")


def _replace_packs(conn: psycopg.Connection, product_id: int, packs: list[PackUnit]) -> None:
    conn.execute("DELETE FROM pack_units WHERE product_id = %s", (product_id,))
    for p in packs:
        conn.execute(
            "INSERT INTO pack_units (product_id, unit, base_qty) VALUES (%s, %s, %s)",
            (product_id, p.unit, p.base_qty),
        )


def create_product(conn: psycopg.Connection, ws: int, data: ProductIn) -> Product:
    """New products start with no stock. Stock changes only when a delivery is accepted."""
    _require_category(conn, ws, data.category_id)
    plans.require(conn, ws, "product")
    with conn.transaction():
        row = conn.execute(
            "INSERT INTO products "
            "(workspace_id, name, category_id, base_unit, temp_min_c, temp_max_c, min_stock, sop, code, barcode, "
            "track_expiry, min_days_left, warn_days) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                ws,
                data.name,
                data.category_id,
                data.base_unit,
                data.temp_min_c,
                data.temp_max_c,
                data.min_stock,
                data.sop,
                data.code,
                data.barcode,
                data.track_expiry,
                data.min_days_left,
                data.warn_days,
            ),
        ).fetchone()
        _replace_packs(conn, row["id"], data.pack_units)
    return get_product(conn, ws, row["id"])


def create_products(conn: psycopg.Connection, ws: int, items: list[ProductIn]) -> list[Product]:
    """Create several products in one transaction: if any is refused, none are kept."""
    with conn.transaction():
        return [create_product(conn, ws, item) for item in items]


def update_product(conn: psycopg.Connection, ws: int, product_id: int, data: ProductIn) -> Product:
    _require_category(conn, ws, data.category_id)
    with conn.transaction():
        cur = conn.execute(
            "UPDATE products SET name = %s, category_id = %s, base_unit = %s, temp_min_c = %s, "
            "temp_max_c = %s, min_stock = %s, sop = %s, code = %s, barcode = %s, track_expiry = %s, "
            "min_days_left = %s, warn_days = %s WHERE id = %s AND workspace_id = %s",
            (
                data.name,
                data.category_id,
                data.base_unit,
                data.temp_min_c,
                data.temp_max_c,
                data.min_stock,
                data.sop,
                data.code,
                data.barcode,
                data.track_expiry,
                data.min_days_left,
                data.warn_days,
                product_id,
                ws,
            ),
        )
        if cur.rowcount == 0:
            raise NotFoundError(f"product {product_id} not found")
        _replace_packs(conn, product_id, data.pack_units)
    return get_product(conn, ws, product_id)


def set_archived(conn: psycopg.Connection, ws: int, product_id: int, archived: bool) -> Product:
    if not archived and conn.execute(
        "SELECT archived FROM products WHERE id = %s AND workspace_id = %s", (product_id, ws)
    ).fetchone() == {"archived": True}:
        plans.require(conn, ws, "product")  # bringing one back counts towards the Free limit
    cur = conn.execute(
        "UPDATE products SET archived = %s WHERE id = %s AND workspace_id = %s",
        (archived, product_id, ws),
    )
    if cur.rowcount == 0:
        raise NotFoundError(f"product {product_id} not found")
    return get_product(conn, ws, product_id)


def delete_product(conn: psycopg.Connection, ws: int, product_id: int) -> None:
    # A product that appears on a delivery is protected by the foreign key (HTTP 409).
    cur = conn.execute("DELETE FROM products WHERE id = %s AND workspace_id = %s", (product_id, ws))
    if cur.rowcount == 0:
        raise NotFoundError(f"product {product_id} not found")
    # A plain id list has no foreign key, so take the product off its suppliers' lists here.
    conn.execute(
        "UPDATE suppliers SET product_ids = array_remove(product_ids, %s) WHERE workspace_id = %s",
        (product_id, ws),
    )


# ---- matching order text to products ----------------------------------------------------------


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _contains_words(outer: str, inner: str) -> bool:
    return f" {inner} " in f" {outer} "


def match_product(name: str, products: list[Product]) -> int | None:
    """Match a line name read from a photo to a catalogue product, or None if unsure.

    Exact match on the normalised name wins. Otherwise a whole-word containment either way
    counts, but only when exactly one product fits. Staff confirm every match anyway.
    """
    target = _norm(name)
    if not target:
        return None
    for p in products:
        if _norm(p.name) == target:
            return p.id
    hits = [
        p
        for p in products
        if _contains_words(target, _norm(p.name)) or _contains_words(_norm(p.name), target)
    ]
    return hits[0].id if len(hits) == 1 else None
