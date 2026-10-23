"""PostgreSQL access. One schema, one dialect: the same SQL runs in tests, locally and on Replit.

Every business table carries `workspace_id`, and every query filters on it. Row Level Security
(see `RLS_TABLES`) repeats that rule inside the database, so a missed filter cannot leak a
workspace's data. Quantities are stored in base units (see rules.to_base_units).
"""

from collections.abc import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import get_settings

_ID = "BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY"

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS workspaces (
    id {_ID},
    name TEXT NOT NULL,
    telegram_manager_chat_id TEXT NOT NULL DEFAULT '',
    telegram_staff_chat_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
    password_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (lower(username));
-- Added after the first deploy: ALTER keeps databases created before it working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_one_owner_key ON users (workspace_id) WHERE role = 'owner';
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    temp_min_c DOUBLE PRECISION,
    temp_max_c DOUBLE PRECISION
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_key ON categories (workspace_id, lower(name));
CREATE TABLE IF NOT EXISTS products (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category_id BIGINT NOT NULL REFERENCES categories(id),
    base_unit TEXT NOT NULL,
    temp_min_c DOUBLE PRECISION,
    temp_max_c DOUBLE PRECISION,
    min_stock BIGINT NOT NULL DEFAULT 0,
    stock BIGINT NOT NULL DEFAULT 0,
    sop TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS products_name_key ON products (workspace_id, lower(name));
-- Archived products keep their delivery history but are left out of receiving.
ALTER TABLE products ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS pack_units (
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit TEXT NOT NULL,
    base_qty BIGINT NOT NULL CHECK (base_qty > 0),
    PRIMARY KEY (product_id, unit)
);
CREATE TABLE IF NOT EXISTS deliveries (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    supplier TEXT NOT NULL DEFAULT '',
    received_by TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('accepted', 'pending_approval', 'rejected', 'returned')),
    created_at TEXT NOT NULL,
    decided_by TEXT,
    decided_at TEXT,
    decision_reason TEXT
);
CREATE INDEX IF NOT EXISTS deliveries_workspace_idx ON deliveries (workspace_id, id DESC);
CREATE TABLE IF NOT EXISTS delivery_lines (
    id {_ID},
    delivery_id BIGINT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    product_id BIGINT REFERENCES products(id),
    name TEXT NOT NULL,
    quantity BIGINT NOT NULL,
    unit TEXT NOT NULL,
    temp_c DOUBLE PRECISION,
    expected_base_qty BIGINT,
    received_base_qty BIGINT,
    passed BOOLEAN NOT NULL,
    issues TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS suppliers (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    archived BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_key ON suppliers (workspace_id, lower(name));
-- Quantity-only purchase orders: what was ordered, not what it cost.
CREATE TABLE IF NOT EXISTS purchase_orders (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    number BIGINT NOT NULL,
    supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
    status TEXT NOT NULL CHECK (status IN ('draft', 'issued', 'cancelled')),
    order_date TEXT NOT NULL,
    expected_date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    issued_by TEXT,
    issued_at TEXT,
    cancelled_by TEXT,
    cancelled_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_number_key ON purchase_orders (workspace_id, number);
-- ordered_base_qty fixes the pack conversion when the line is saved, so a later change to the
-- product's pack sizes cannot change what was ordered.
CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id {_ID},
    purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id),
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    ordered_base_qty BIGINT NOT NULL CHECK (ordered_base_qty > 0),
    UNIQUE (purchase_order_id, product_id)
);
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT REFERENCES purchase_orders(id);
CREATE TABLE IF NOT EXISTS audit_log (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    delivery_id BIGINT,
    detail TEXT NOT NULL DEFAULT ''
);
"""

# Tables whose rows belong to one workspace, and the SQL condition that proves it. A row is visible
# only when it belongs to the workspace in the `app.workspace_id` setting, which each request sets
# after it has authenticated the user. `users`, `sessions` and `workspaces` are looked up before
# the workspace is known (login, register), so the application code guards those.
# NULLIF: after RESET, an unset custom setting reads as '' rather than NULL, and ''::bigint fails.
_WS = "NULLIF(current_setting('app.workspace_id', true), '')::bigint"

RLS_TABLES = {
    "categories": f"workspace_id = {_WS}",
    "products": f"workspace_id = {_WS}",
    "deliveries": f"workspace_id = {_WS}",
    "audit_log": f"workspace_id = {_WS}",
    "suppliers": f"workspace_id = {_WS}",
    "purchase_orders": f"workspace_id = {_WS}",
    "purchase_order_lines": (
        f"EXISTS (SELECT 1 FROM purchase_orders o WHERE o.id = purchase_order_lines.purchase_order_id "
        f"AND o.workspace_id = {_WS})"
    ),
    "pack_units": (
        f"EXISTS (SELECT 1 FROM products p WHERE p.id = pack_units.product_id "
        f"AND p.workspace_id = {_WS})"
    ),
    "delivery_lines": (
        f"EXISTS (SELECT 1 FROM deliveries d WHERE d.id = delivery_lines.delivery_id "
        f"AND d.workspace_id = {_WS})"
    ),
}

_pool: ConnectionPool | None = None
_pool_url = ""


def _get_pool() -> ConnectionPool:
    global _pool, _pool_url
    url = get_settings().database_url
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    if _pool is None or url != _pool_url:
        if _pool is not None:
            _pool.close()
        # autocommit: reads run outside a transaction, and writers open their own with
        # `conn.transaction()`, so a request never holds a transaction by accident.
        # Hosted PostgreSQL (Replit's) drops idle connections. check= tests each connection before
        # a request gets it and replaces a dead one; max_idle closes ours first. Without these the
        # first request after a quiet spell failed with HTTP 500.
        _pool = ConnectionPool(
            url,
            min_size=1,
            max_size=10,
            kwargs={"autocommit": True, "row_factory": dict_row},
            check=ConnectionPool.check_connection,
            max_idle=60,
            open=True,
        )
        _pool_url = url
    return _pool


def close_pool() -> None:
    global _pool, _pool_url
    if _pool is not None:
        _pool.close()
    _pool, _pool_url = None, ""


def init_db() -> None:
    """Create the tables and the row-level-security policies. Safe to run on every start."""
    with _get_pool().connection() as conn:
        # Several instances can start together on autoscale. The lock makes them take turns.
        conn.execute("SELECT pg_advisory_lock(7461)")
        try:
            conn.execute(SCHEMA)
            for table, condition in RLS_TABLES.items():
                conn.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
                # FORCE applies the policy to the table owner too, which is who the app connects as.
                conn.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
                conn.execute(f"DROP POLICY IF EXISTS workspace_isolation ON {table}")
                conn.execute(
                    f"CREATE POLICY workspace_isolation ON {table} USING ({condition}) "
                    f"WITH CHECK ({condition})"
                )
        finally:
            conn.execute("SELECT pg_advisory_unlock(7461)")


def get_db() -> Iterator[psycopg.Connection]:
    """One pooled connection per request."""
    with _get_pool().connection() as conn:
        try:
            yield conn
        finally:
            # The pool reuses this connection: forget which workspace it served.
            if not conn.closed:
                conn.execute("RESET app.workspace_id")


def scope_to_workspace(conn: psycopg.Connection, workspace_id: int) -> None:
    """Tell the database which workspace this connection serves. Reset when the pool takes it back."""
    conn.execute("SELECT set_config('app.workspace_id', %s, false)", (str(workspace_id),))
