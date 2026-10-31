"""Outlets, their storage areas (Store, Substore), and stock kept per storage area.

products.stock stays the workspace total, so low stock, the dashboard and purchasing keep reading
one number. Every stock change goes through `adjust`, which moves a storage area's level and the
total together. A workspace gets its first outlet and store the first time stock is touched; that
store takes all the stock the workspace had before storage areas existed.
"""

from datetime import datetime, timezone

import psycopg

from app import plans
from app.auditlog import audit
from app.errors import ConflictError, ForbiddenError, InvalidRequestError, NotFoundError
from app.models import OutletOut, SetupOut, StockLevelOut, StorageOut, TransferIn, TransferLineOut, TransferOut

DEFAULT_OUTLET = "Main outlet"
DEFAULT_STORAGE = "Store"

# A storage area as people read it: "Main outlet / Store".
LABEL_SQL = "(o.name || ' / ' || s.name)"
# The outlet the signed-in person is tied to (auth.act_as), or NULL for the owner and anyone free to work anywhere.
OWN_OUTLET = "NULLIF(current_setting('app.outlet_id', true), '')::bigint"


def mine(storage_col: str) -> str:
    """SQL: this row's storage area is in the person's outlet, or they are not tied to one."""
    return f"({OWN_OUTLET} IS NULL OR {storage_col} IN (SELECT id FROM storages WHERE outlet_id = {OWN_OUTLET}))"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_storage(conn: psycopg.Connection, ws: int) -> int:
    """The workspace's first storage area, made (with its outlet) if there is none yet."""
    row = conn.execute(
        "SELECT id FROM storages WHERE workspace_id = %s ORDER BY id LIMIT 1", (ws,)
    ).fetchone()
    if row is not None:
        return row["id"]
    with conn.transaction():
        # Two requests at once must not both create one.
        conn.execute("SELECT id FROM workspaces WHERE id = %s FOR UPDATE", (ws,))
        row = conn.execute(
            "SELECT id FROM storages WHERE workspace_id = %s ORDER BY id LIMIT 1", (ws,)
        ).fetchone()
        if row is not None:
            return row["id"]
        outlet = conn.execute(
            "INSERT INTO outlets (workspace_id, name) VALUES (%s, %s) RETURNING id", (ws, DEFAULT_OUTLET)
        ).fetchone()["id"]
        storage = conn.execute(
            "INSERT INTO storages (workspace_id, outlet_id, name) VALUES (%s, %s, %s) RETURNING id",
            (ws, outlet, DEFAULT_STORAGE),
        ).fetchone()["id"]
        conn.execute(
            "INSERT INTO stock_levels (workspace_id, product_id, storage_id, quantity) "
            "SELECT workspace_id, id, %s, stock FROM products WHERE workspace_id = %s AND stock > 0",
            (storage, ws),
        )
    return storage


def storage_label(conn: psycopg.Connection, ws: int, storage_id: int) -> str:
    row = conn.execute(
        f"SELECT {LABEL_SQL} AS label FROM storages s JOIN outlets o ON o.id = s.outlet_id "
        "WHERE s.id = %s AND s.workspace_id = %s",
        (storage_id, ws),
    ).fetchone()
    if row is None:
        raise InvalidRequestError(f"unknown storage area {storage_id}")
    return row["label"]


def resolve(conn: psycopg.Connection, ws: int, storage_id: int | None) -> int:
    """The storage area asked for, checked to be this workspace's and in the person's outlet, or their first one."""
    first = default_storage(conn, ws)
    if storage_id is None:
        own = conn.execute(
            f"SELECT id FROM storages WHERE workspace_id = %s AND outlet_id = {OWN_OUTLET} ORDER BY id LIMIT 1", (ws,)
        ).fetchone()
        return own["id"] if own else first
    storage_label(conn, ws, storage_id)
    if not conn.execute(f"SELECT 1 FROM storages WHERE id = %s AND {mine('id')}", (storage_id,)).fetchone():
        raise ForbiddenError("you work at another outlet, so you cannot use that storage area")
    return storage_id


def levels(conn: psycopg.Connection, storage_id: int, product_ids: list[int]) -> dict[int, int]:
    """Each product's quantity in the storage area, locked until the transaction ends. Missing: 0."""
    rows = conn.execute(
        "SELECT product_id, quantity FROM stock_levels WHERE storage_id = %s AND product_id = ANY(%s) "
        "ORDER BY product_id FOR UPDATE",
        (storage_id, product_ids),
    ).fetchall()
    found = {r["product_id"]: r["quantity"] for r in rows}
    return {product_id: found.get(product_id, 0) for product_id in product_ids}


def adjust(conn: psycopg.Connection, ws: int, product_id: int, storage_id: int, delta: int) -> None:
    """Add `delta` base units to the product in the storage area and to its total. The caller
    checks that the level stays at 0 or more (the table refuses less)."""
    if delta == 0:
        return
    if delta > 0:
        conn.execute(
            "INSERT INTO stock_levels (workspace_id, product_id, storage_id, quantity) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (product_id, storage_id) DO UPDATE SET quantity = stock_levels.quantity + EXCLUDED.quantity",
            (ws, product_id, storage_id, delta),
        )
    else:
        # Not an upsert: the CHECK is tested on the would-be inserted row, which is negative.
        conn.execute(
            "UPDATE stock_levels SET quantity = quantity + %s WHERE product_id = %s AND storage_id = %s",
            (delta, product_id, storage_id),
        )
    conn.execute(
        "UPDATE products SET stock = stock + %s WHERE id = %s AND workspace_id = %s", (delta, product_id, ws)
    )


# ---- outlets and storage areas ------------------------------------------------------------------


def list_outlets(conn: psycopg.Connection, ws: int) -> list[OutletOut]:
    default_storage(conn, ws)
    outlets = conn.execute(
        f"SELECT id, name FROM outlets WHERE workspace_id = %s AND ({OWN_OUTLET} IS NULL OR id = {OWN_OUTLET}) "
        "ORDER BY lower(name)",
        (ws,),
    ).fetchall()
    storages = conn.execute(
        f"SELECT s.id, s.name, s.outlet_id, o.name AS outlet, {LABEL_SQL} AS label "
        f"FROM storages s JOIN outlets o ON o.id = s.outlet_id WHERE s.workspace_id = %s AND {mine('s.id')} "
        "ORDER BY lower(s.name)",
        (ws,),
    ).fetchall()
    return [
        OutletOut(id=o["id"], name=o["name"], storages=[StorageOut(**s) for s in storages if s["outlet_id"] == o["id"]])
        for o in outlets
    ]


def create_outlet(conn: psycopg.Connection, ws: int, by: str, name: str) -> list[OutletOut]:
    """A new outlet comes with one storage area, its store. Free includes one outlet."""
    default_storage(conn, ws)
    plans.require(conn, ws, "outlet")
    with conn.transaction():
        outlet = conn.execute(
            "INSERT INTO outlets (workspace_id, name) VALUES (%s, %s) RETURNING id", (ws, name)
        ).fetchone()["id"]
        conn.execute(
            "INSERT INTO storages (workspace_id, outlet_id, name) VALUES (%s, %s, %s)", (ws, outlet, DEFAULT_STORAGE)
        )
        audit(conn, ws, by, "outlet.created", None, name)
    return list_outlets(conn, ws)


def rename_outlet(conn: psycopg.Connection, ws: int, by: str, outlet_id: int, name: str) -> list[OutletOut]:
    with conn.transaction():
        old = conn.execute(
            "SELECT name FROM outlets WHERE id = %s AND workspace_id = %s FOR UPDATE", (outlet_id, ws)
        ).fetchone()
        if old is None:
            raise NotFoundError(f"outlet {outlet_id} not found")
        conn.execute("UPDATE outlets SET name = %s WHERE id = %s", (name, outlet_id))
        audit(conn, ws, by, "outlet.renamed", None, f"{old['name']} -> {name}")
    return list_outlets(conn, ws)


def _remove_storages(conn: psycopg.Connection, ws: int, storage_ids: list[int]) -> None:
    """Delete empty storage areas, leaving the workspace at least one. Raises when one holds stock;
    one with history (deliveries, counts, transfers, sales) is refused by its foreign keys."""
    remaining = conn.execute(
        "SELECT count(*) AS n FROM storages WHERE workspace_id = %s AND NOT (id = ANY(%s))", (ws, storage_ids)
    ).fetchone()["n"]
    if remaining == 0:
        raise ConflictError("a workspace needs at least one storage area")
    conn.execute("DELETE FROM stock_levels WHERE storage_id = ANY(%s) AND quantity = 0", (storage_ids,))
    if conn.execute("SELECT 1 FROM stock_levels WHERE storage_id = ANY(%s) LIMIT 1", (storage_ids,)).fetchone():
        raise ConflictError("this still holds stock: transfer it out first")
    conn.execute("DELETE FROM storages WHERE id = ANY(%s) AND workspace_id = %s", (storage_ids, ws))


def delete_outlet(conn: psycopg.Connection, ws: int, by: str, outlet_id: int) -> list[OutletOut]:
    default_storage(conn, ws)
    with conn.transaction():
        outlet = conn.execute(
            "SELECT name FROM outlets WHERE id = %s AND workspace_id = %s FOR UPDATE", (outlet_id, ws)
        ).fetchone()
        if outlet is None:
            raise NotFoundError(f"outlet {outlet_id} not found")
        ids = [r["id"] for r in conn.execute("SELECT id FROM storages WHERE outlet_id = %s", (outlet_id,)).fetchall()]
        _remove_storages(conn, ws, ids)
        conn.execute("DELETE FROM outlets WHERE id = %s", (outlet_id,))
        audit(conn, ws, by, "outlet.deleted", None, outlet["name"])
    return list_outlets(conn, ws)


def create_storage(conn: psycopg.Connection, ws: int, by: str, outlet_id: int, name: str) -> list[OutletOut]:
    default_storage(conn, ws)
    with conn.transaction():
        outlet = conn.execute(
            "SELECT name FROM outlets WHERE id = %s AND workspace_id = %s", (outlet_id, ws)
        ).fetchone()
        if outlet is None:
            raise InvalidRequestError(f"unknown outlet {outlet_id}")
        conn.execute(
            "INSERT INTO storages (workspace_id, outlet_id, name) VALUES (%s, %s, %s)", (ws, outlet_id, name)
        )
        audit(conn, ws, by, "storage.created", None, f"{outlet['name']} / {name}")
    return list_outlets(conn, ws)


def rename_storage(conn: psycopg.Connection, ws: int, by: str, storage_id: int, name: str) -> list[OutletOut]:
    with conn.transaction():
        old = storage_label(conn, ws, storage_id)
        conn.execute("UPDATE storages SET name = %s WHERE id = %s AND workspace_id = %s", (name, storage_id, ws))
        audit(conn, ws, by, "storage.renamed", None, f"{old} -> {name}")
    return list_outlets(conn, ws)


def delete_storage(conn: psycopg.Connection, ws: int, by: str, storage_id: int) -> list[OutletOut]:
    default_storage(conn, ws)
    with conn.transaction():
        label = storage_label(conn, ws, storage_id)
        _remove_storages(conn, ws, [storage_id])
        audit(conn, ws, by, "storage.deleted", None, label)
    return list_outlets(conn, ws)


def setup_progress(conn: psycopg.Connection, ws: int) -> SetupOut:
    """The owner's setup checklist, worked out from what the workspace already has."""
    row = conn.execute(
        "SELECT EXISTS (SELECT 1 FROM outlets WHERE workspace_id = %(ws)s AND name <> %(outlet)s) AS outlet, "
        "EXISTS (SELECT 1 FROM storages WHERE workspace_id = %(ws)s AND name <> %(storage)s) AS storage, "
        "EXISTS (SELECT 1 FROM products WHERE workspace_id = %(ws)s) AS product, "
        "EXISTS (SELECT 1 FROM users WHERE workspace_id = %(ws)s AND role <> 'owner') AS team, "
        "EXISTS (SELECT 1 FROM deliveries WHERE workspace_id = %(ws)s) AS delivery",
        {"ws": ws, "outlet": DEFAULT_OUTLET, "storage": DEFAULT_STORAGE},
    ).fetchone()
    return SetupOut(**row)


def stock_in(conn: psycopg.Connection, ws: int, storage_id: int) -> list[StockLevelOut]:
    """Every active product with its quantity in this storage area and its total."""
    resolve(conn, ws, storage_id)
    rows = conn.execute(
        "SELECT p.id AS product_id, p.name, p.code, p.barcode, c.name AS category, p.base_unit, "
        "COALESCE(l.quantity, 0) AS quantity, p.stock AS total "
        "FROM products p JOIN categories c ON c.id = p.category_id "
        "LEFT JOIN stock_levels l ON l.product_id = p.id AND l.storage_id = %s "
        "WHERE p.workspace_id = %s AND NOT p.archived ORDER BY lower(c.name), lower(p.name)",
        (storage_id, ws),
    ).fetchall()
    return [StockLevelOut(**r) for r in rows]


# ---- transfers ----------------------------------------------------------------------------------


def _transfers(conn: psycopg.Connection, ws: int, where: str, params: tuple) -> list[TransferOut]:
    rows = conn.execute(
        "SELECT t.*, "
        "(SELECT o.name || ' / ' || s.name FROM storages s JOIN outlets o ON o.id = s.outlet_id "
        " WHERE s.id = t.from_storage_id) AS from_label, "
        "(SELECT o.name || ' / ' || s.name FROM storages s JOIN outlets o ON o.id = s.outlet_id "
        " WHERE s.id = t.to_storage_id) AS to_label "
        f"FROM stock_transfers t WHERE t.workspace_id = %s {where} ORDER BY t.id DESC LIMIT 50",
        (ws, *params),
    ).fetchall()
    lines = conn.execute(
        "SELECT transfer_id, product_id, product_name, base_unit, quantity FROM stock_transfer_lines "
        "WHERE transfer_id = ANY(%s) ORDER BY id",
        ([r["id"] for r in rows],),
    ).fetchall()
    return [
        TransferOut(
            id=r["id"],
            reference=f"TR-{r['number']:06d}",
            from_storage=r["from_label"],
            to_storage=r["to_label"],
            moved_by=r["moved_by"],
            created_at=r["created_at"],
            notes=r["notes"],
            lines=[TransferLineOut(**{k: v for k, v in line.items() if k != "transfer_id"})
                   for line in lines if line["transfer_id"] == r["id"]],
        )
        for r in rows
    ]


def list_transfers(conn: psycopg.Connection, ws: int) -> list[TransferOut]:
    return _transfers(conn, ws, f"AND ({mine('t.from_storage_id')} OR {mine('t.to_storage_id')})", ())


def create_transfer(conn: psycopg.Connection, ws: int, by: str, data: TransferIn) -> TransferOut:
    """Move stock between two storage areas at once. Refused when the source holds too little."""
    source = resolve(conn, ws, data.from_storage_id)
    target = resolve(conn, ws, data.to_storage_id)
    product_ids = [line.product_id for line in data.lines]
    with conn.transaction():
        conn.execute("SELECT id FROM workspaces WHERE id = %s FOR UPDATE", (ws,))  # numbers in order
        products = {
            r["id"]: r
            for r in conn.execute(
                "SELECT id, name, base_unit FROM products WHERE workspace_id = %s AND NOT archived "
                "AND id = ANY(%s) ORDER BY id FOR UPDATE",
                (ws, product_ids),
            ).fetchall()
        }
        if set(products) != set(product_ids):
            raise InvalidRequestError("one or more products are unknown or archived")
        have = levels(conn, source, product_ids)
        from_label, to_label = storage_label(conn, ws, source), storage_label(conn, ws, target)
        for line in data.lines:
            product = products[line.product_id]
            if line.quantity > have[line.product_id]:
                raise ConflictError(
                    f"{from_label} only has {have[line.product_id]} {product['base_unit']} of {product['name']}"
                )
        number = conn.execute(
            "SELECT COALESCE(MAX(number), 0) + 1 AS n FROM stock_transfers WHERE workspace_id = %s", (ws,)
        ).fetchone()["n"]
        transfer_id = conn.execute(
            "INSERT INTO stock_transfers (workspace_id, number, from_storage_id, to_storage_id, moved_by, "
            "created_at, notes) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (ws, number, source, target, by, _now(), data.notes),
        ).fetchone()["id"]
        for line in data.lines:
            product = products[line.product_id]
            conn.execute(
                "INSERT INTO stock_transfer_lines (transfer_id, product_id, product_name, base_unit, quantity) "
                "VALUES (%s, %s, %s, %s, %s)",
                (transfer_id, line.product_id, product["name"], product["base_unit"], line.quantity),
            )
            adjust(conn, ws, line.product_id, source, -line.quantity)
            adjust(conn, ws, line.product_id, target, line.quantity)
        audit(
            conn, ws, by, "stock.transferred", None,
            f"TR-{number:06d}: {len(data.lines)} product(s) from {from_label} to {to_label}",
        )
    return _transfers(conn, ws, "AND t.id = %s", (transfer_id,))[0]
