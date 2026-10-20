"""Categories and products: create, read, update, delete, and search (the SOP lookup)."""

import re
import sqlite3
from collections import defaultdict

from app.errors import InvalidRequestError, NotFoundError
from app.models import Category, CategoryIn, PackUnit, Product, ProductIn

_PRODUCT_SELECT = """
SELECT p.*, c.name AS category, c.temp_min_c AS cat_min, c.temp_max_c AS cat_max
FROM products p JOIN categories c ON c.id = p.category_id
"""


# ---- categories -------------------------------------------------------------------------------


def list_categories(conn: sqlite3.Connection) -> list[Category]:
    rows = conn.execute("SELECT * FROM categories ORDER BY name").fetchall()
    return [Category(**dict(r)) for r in rows]


def get_category(conn: sqlite3.Connection, category_id: int) -> Category:
    row = conn.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
    if row is None:
        raise NotFoundError(f"category {category_id} not found")
    return Category(**dict(row))


def create_category(conn: sqlite3.Connection, data: CategoryIn) -> Category:
    with conn:
        cur = conn.execute(
            "INSERT INTO categories (name, temp_min_c, temp_max_c) VALUES (?, ?, ?)",
            (data.name, data.temp_min_c, data.temp_max_c),
        )
    return get_category(conn, cur.lastrowid)


def update_category(conn: sqlite3.Connection, category_id: int, data: CategoryIn) -> Category:
    with conn:
        cur = conn.execute(
            "UPDATE categories SET name = ?, temp_min_c = ?, temp_max_c = ? WHERE id = ?",
            (data.name, data.temp_min_c, data.temp_max_c, category_id),
        )
        if cur.rowcount == 0:
            raise NotFoundError(f"category {category_id} not found")
    return get_category(conn, category_id)


def delete_category(conn: sqlite3.Connection, category_id: int) -> None:
    # A category that still has products is protected by the foreign key (HTTP 409).
    with conn:
        cur = conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
        if cur.rowcount == 0:
            raise NotFoundError(f"category {category_id} not found")


# ---- products ---------------------------------------------------------------------------------


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _load(conn: sqlite3.Connection, where: str = "", params: tuple = ()) -> list[Product]:
    rows = conn.execute(f"{_PRODUCT_SELECT} {where} ORDER BY p.name", params).fetchall()
    packs: dict[int, list[PackUnit]] = defaultdict(list)
    ids = [r["id"] for r in rows]
    if ids:
        marks = ",".join("?" * len(ids))
        pack_rows = conn.execute(
            f"SELECT product_id, unit, base_qty FROM pack_units "
            f"WHERE product_id IN ({marks}) ORDER BY base_qty, unit",
            ids,
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
                low_stock=r["stock"] < r["min_stock"],
            )
        )
    return products


def list_products(conn: sqlite3.Connection, q: str | None = None) -> list[Product]:
    """All products, or those whose name, category or SOP text contains `q`."""
    if q and q.strip():
        like = f"%{_escape_like(q.strip())}%"
        where = (
            "WHERE p.name LIKE ? ESCAPE '\\' OR p.sop LIKE ? ESCAPE '\\' "
            "OR c.name LIKE ? ESCAPE '\\'"
        )
        return _load(conn, where, (like, like, like))
    return _load(conn)


def get_product(conn: sqlite3.Connection, product_id: int) -> Product:
    found = _load(conn, "WHERE p.id = ?", (product_id,))
    if not found:
        raise NotFoundError(f"product {product_id} not found")
    return found[0]


def _require_category(conn: sqlite3.Connection, category_id: int) -> None:
    if conn.execute("SELECT 1 FROM categories WHERE id = ?", (category_id,)).fetchone() is None:
        raise InvalidRequestError(f"unknown category_id {category_id}")


def _replace_packs(conn: sqlite3.Connection, product_id: int, packs: list[PackUnit]) -> None:
    conn.execute("DELETE FROM pack_units WHERE product_id = ?", (product_id,))
    conn.executemany(
        "INSERT INTO pack_units (product_id, unit, base_qty) VALUES (?, ?, ?)",
        [(product_id, p.unit, p.base_qty) for p in packs],
    )


def create_product(conn: sqlite3.Connection, data: ProductIn, stock: int = 0) -> Product:
    """`stock` is only for seeding. After that, stock changes only when a delivery is accepted."""
    _require_category(conn, data.category_id)
    with conn:
        cur = conn.execute(
            "INSERT INTO products "
            "(name, category_id, base_unit, temp_min_c, temp_max_c, min_stock, stock, sop) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                data.name,
                data.category_id,
                data.base_unit,
                data.temp_min_c,
                data.temp_max_c,
                data.min_stock,
                stock,
                data.sop,
            ),
        )
        _replace_packs(conn, cur.lastrowid, data.pack_units)
    return get_product(conn, cur.lastrowid)


def update_product(conn: sqlite3.Connection, product_id: int, data: ProductIn) -> Product:
    _require_category(conn, data.category_id)
    with conn:
        cur = conn.execute(
            "UPDATE products SET name = ?, category_id = ?, base_unit = ?, temp_min_c = ?, "
            "temp_max_c = ?, min_stock = ?, sop = ? WHERE id = ?",
            (
                data.name,
                data.category_id,
                data.base_unit,
                data.temp_min_c,
                data.temp_max_c,
                data.min_stock,
                data.sop,
                product_id,
            ),
        )
        if cur.rowcount == 0:
            raise NotFoundError(f"product {product_id} not found")
        _replace_packs(conn, product_id, data.pack_units)
    return get_product(conn, product_id)


def delete_product(conn: sqlite3.Connection, product_id: int) -> None:
    # A product that appears on a delivery is protected by the foreign key (HTTP 409).
    with conn:
        cur = conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
        if cur.rowcount == 0:
            raise NotFoundError(f"product {product_id} not found")


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
