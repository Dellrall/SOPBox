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
    section_access JSONB NOT NULL DEFAULT '{{"dashboard":"view","receive":"edit","records":"view","products":"view","purchasing":"none","approvals":"none","activity":"none","stocktake":"view"}}'::jsonb,
    password_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (lower(username));
-- Added after the first deploy: ALTER keeps databases created before it working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS section_access JSONB NOT NULL
    DEFAULT '{{"dashboard":"view","receive":"edit","records":"view","products":"view","purchasing":"none","approvals":"none","activity":"none","stocktake":"view"}}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_one_owner_key ON users (workspace_id) WHERE role = 'owner';
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
-- The sign-in that started the session (sign_ins is created further down, so no reference here).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sign_in_id BIGINT;
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
-- A line sent back while the rest of its delivery was accepted ("accept the good lines").
ALTER TABLE delivery_lines ADD COLUMN IF NOT EXISTS returned BOOLEAN NOT NULL DEFAULT FALSE;
-- Photos of the stock taken while receiving, for the manager who approves it. JPEG, shrunk on the phone.
CREATE TABLE IF NOT EXISTS delivery_photos (
    id {_ID},
    delivery_id BIGINT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    data BYTEA NOT NULL,
    caption TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS delivery_photos_delivery_idx ON delivery_photos (delivery_id);
-- Staff and managers discussing a photo, e.g. for a complaint to the supplier.
CREATE TABLE IF NOT EXISTS delivery_photo_comments (
    id {_ID},
    photo_id BIGINT NOT NULL REFERENCES delivery_photos(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS delivery_photo_comments_photo_idx ON delivery_photo_comments (photo_id);
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
-- The products a supplier sells, picked from the catalogue.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS product_ids BIGINT[] NOT NULL DEFAULT '{{}}';
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
CREATE TABLE IF NOT EXISTS stocktakes (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    number BIGINT NOT NULL,
    reference TEXT NOT NULL,
    count_date DATE NOT NULL,
    counted_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    UNIQUE (workspace_id, number),
    UNIQUE (workspace_id, reference)
);
CREATE TABLE IF NOT EXISTS stocktake_lines (
    id {_ID},
    stocktake_id BIGINT NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
    product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    base_unit TEXT NOT NULL,
    expected_stock BIGINT NOT NULL CHECK (expected_stock >= 0),
    counted_stock BIGINT NOT NULL CHECK (counted_stock >= 0),
    difference BIGINT NOT NULL
);
-- Accountability: the signed-in account behind each logged action (NULL for "system" and for
-- entries written before this column existed). Set from the request, see scope_to_user.
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_id BIGINT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (workspace_id, actor_id, id DESC);
-- Who received a delivery, as an account, so they can be told about its decision and comments.
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS received_by_id BIGINT REFERENCES users(id);
-- Teammates tagged on a delivery, from the receiving form, the delivery itself or an @mention.
CREATE TABLE IF NOT EXISTS delivery_tags (
    delivery_id BIGINT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tagged_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (delivery_id, user_id)
);
-- Each person's inbox. The text is written when the event happens, like the audit log.
CREATE TABLE IF NOT EXISTS notifications (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('tagged', 'approval_needed', 'decided', 'comment')),
    delivery_id BIGINT REFERENCES deliveries(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, id DESC);
-- New sign-ins from an unfamiliar device or method are announced in the inbox too.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('tagged', 'approval_needed', 'decided', 'comment', 'sign_in', 'security'));
-- Other ways to sign in. Google and Telegram are linked by the person, from Settings, while
-- signed in: an email typed into SOPBox is never trusted to prove who owns a Google account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_key ON users (google_sub) WHERE google_sub IS NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT;
CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_key ON users (telegram_id) WHERE telegram_id IS NOT NULL;
-- A short number for the kitchen tablet, hashed like a password.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
CREATE TABLE IF NOT EXISTS passkeys (
    id {_ID},
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id BYTEA NOT NULL UNIQUE,
    public_key BYTEA NOT NULL,
    sign_count BIGINT NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys (user_id);
-- One step of a sign-in that spans two requests (a passkey challenge, a Google redirect). The
-- browser holds a random token in a cookie; this row holds its hash. Used once, then deleted.
CREATE TABLE IF NOT EXISTS auth_flows (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    data JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
-- Shared kitchen tablets: a manager marks a browser, then anyone with a PIN signs in by tapping
-- their name. The browser holds a random token; this holds its hash.
CREATE TABLE IF NOT EXISTS kitchen_devices (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
);
-- Every sign-in, so people can see their last one and owners can see who is still using the app.
CREATE TABLE IF NOT EXISTS sign_ins (
    id {_ID},
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    method TEXT NOT NULL,
    device TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_ins_user_idx ON sign_ins (user_id, id DESC);

-- The workspace's Telegram team group (see team_group.py). Removed people are kept out until the
-- time shown; FOREVER means until the owner lets them back in.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS telegram_team_chat_id TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS telegram_team_title TEXT NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS telegram_team_invite_link TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS team_group_removed_until TEXT;
CREATE INDEX IF NOT EXISTS stocktakes_workspace_idx ON stocktakes (workspace_id, count_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS stocktake_lines_take_idx ON stocktake_lines (stocktake_id, id);

-- Outlets and the storage areas inside each (Store, Substore). Stock is kept per storage area in
-- stock_levels; products.stock stays the total over all of them (see locations.py).
CREATE TABLE IF NOT EXISTS outlets (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outlets_name_key ON outlets (workspace_id, lower(name));
CREATE TABLE IF NOT EXISTS storages (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    outlet_id BIGINT NOT NULL REFERENCES outlets(id),
    name TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS storages_name_key ON storages (outlet_id, lower(name));
CREATE TABLE IF NOT EXISTS stock_levels (
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    storage_id BIGINT NOT NULL REFERENCES storages(id),
    quantity BIGINT NOT NULL CHECK (quantity >= 0),
    PRIMARY KEY (product_id, storage_id)
);
CREATE INDEX IF NOT EXISTS stock_levels_storage_idx ON stock_levels (storage_id);
-- Where a delivery is put away and which storage area a count covers. NULL: the first storage area.
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS storage_id BIGINT REFERENCES storages(id);
ALTER TABLE stocktakes ADD COLUMN IF NOT EXISTS storage_id BIGINT REFERENCES storages(id);
-- The code a POS or sales sheet prints for the product (SKU), matched when sales are uploaded.
ALTER TABLE products ADD COLUMN IF NOT EXISTS code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS products_code_key ON products (workspace_id, lower(code)) WHERE code IS NOT NULL;
CREATE TABLE IF NOT EXISTS stock_transfers (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    number BIGINT NOT NULL,
    from_storage_id BIGINT NOT NULL REFERENCES storages(id),
    to_storage_id BIGINT NOT NULL REFERENCES storages(id),
    moved_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    UNIQUE (workspace_id, number)
);
CREATE TABLE IF NOT EXISTS stock_transfer_lines (
    id {_ID},
    transfer_id BIGINT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    base_unit TEXT NOT NULL,
    quantity BIGINT NOT NULL CHECK (quantity > 0)
);
-- Uploaded sales. `deducted` is what came off stock: less than `quantity` when more was sold than
-- the storage area held, which the next count should explain.
CREATE TABLE IF NOT EXISTS sales (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    number BIGINT NOT NULL,
    storage_id BIGINT NOT NULL REFERENCES storages(id),
    sale_date DATE NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    recorded_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (workspace_id, number)
);
CREATE TABLE IF NOT EXISTS sale_lines (
    id {_ID},
    sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
    product_code TEXT NOT NULL,
    product_name TEXT NOT NULL,
    base_unit TEXT NOT NULL,
    quantity BIGINT NOT NULL CHECK (quantity > 0),
    deducted BIGINT NOT NULL CHECK (deducted >= 0)
);
-- A branch workspace linked to its HQ (see hq.py). One level: an HQ is never a branch itself.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS hq_id BIGINT REFERENCES workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS workspaces_hq_idx ON workspaces (hq_id) WHERE hq_id IS NOT NULL;
-- One-time codes an HQ owner hands to a branch owner. Only the code's SHA-256 is kept.
CREATE TABLE IF NOT EXISTS link_codes (
    token_hash TEXT PRIMARY KEY,
    hq_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_by BIGINT REFERENCES workspaces(id) ON DELETE SET NULL,
    used_at TIMESTAMPTZ
);
-- The till's own receipt or batch number for a sale sent with an API key: resending it changes nothing.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS sales_external_ref_key ON sales (workspace_id, external_ref) WHERE external_ref IS NOT NULL;
-- API keys for a till or other system (see apikeys.py). Only the key's SHA-256 is kept. Looked up
-- before the workspace is known, so like sessions it is guarded by the application code, not RLS.
CREATE TABLE IF NOT EXISTS api_keys (
    id {_ID},
    workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    hint TEXT NOT NULL,
    storage_id BIGINT NOT NULL REFERENCES storages(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
);
-- Two-step sign-in (see mfa.py): the authenticator app's secret, the last 30-second step used so a
-- code works once, and one-time backup codes kept only as SHA-256. The owner's policy says who
-- must use it; security_alerts marks who else hears about dangerous actions.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_alerts BOOLEAN NOT NULL DEFAULT FALSE;
-- Who besides the owner may download the workspace's data (export.py). The owner decides.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_export BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS mfa_backup_codes (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    PRIMARY KEY (user_id, code_hash)
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mfa_at TIMESTAMPTZ;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS mfa_policy TEXT NOT NULL DEFAULT 'off'
    CHECK (mfa_policy IN ('off', 'managers', 'everyone'));
-- Plans (see plans.py). Workspaces that existed before plans are pre-alpha users: the column is
-- added as TRUE, so they keep what they set up, and new workspaces then default to FALSE.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS pre_alpha BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE workspaces ALTER COLUMN pre_alpha SET DEFAULT FALSE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'enterprise'));
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan_billing TEXT CHECK (plan_billing IN ('annual', 'lifetime'));
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan_until DATE;  -- annual: paid up to and including
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS paid_outlets INTEGER NOT NULL DEFAULT 0 CHECK (paid_outlets >= 0);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS customization BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS priority_support_until DATE;
-- Closing a business (closing.py): read-only from closing_at, deleted GRACE_DAYS later.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS closing_at TIMESTAMPTZ;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS closed_by TEXT;
-- What is left of a deleted workspace: no foreign key, so it outlives it.
CREATE TABLE IF NOT EXISTS closed_workspaces (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    closed_at TIMESTAMPTZ NOT NULL,
    closed_by TEXT,
    deleted_at TIMESTAMPTZ NOT NULL
);
-- Sales enquiries, upgrade requests and support requests, for the team (and later the internal
-- operations site). Public enquiries have no workspace, so this is guarded by code, not RLS.
CREATE TABLE IF NOT EXISTS inquiries (
    id {_ID},
    kind TEXT NOT NULL CHECK (kind IN ('sales', 'question', 'upgrade', 'support')),
    workspace_id BIGINT REFERENCES workspaces(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    outlets INTEGER,
    message TEXT NOT NULL DEFAULT '',
    priority BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Questions from the public contact page joined later: widen the check on existing databases.
ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS inquiries_kind_check;
ALTER TABLE inquiries ADD CONSTRAINT inquiries_kind_check CHECK (kind IN ('sales', 'question', 'upgrade', 'support'));
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
    "stocktakes": f"workspace_id = {_WS}",
    "stocktake_lines": (
        f"EXISTS (SELECT 1 FROM stocktakes s WHERE s.id = stocktake_lines.stocktake_id "
        f"AND s.workspace_id = {_WS})"
    ),
    "suppliers": f"workspace_id = {_WS}",
    "notifications": f"workspace_id = {_WS}",
    "delivery_tags": (
        f"EXISTS (SELECT 1 FROM deliveries d WHERE d.id = delivery_tags.delivery_id "
        f"AND d.workspace_id = {_WS})"
    ),
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
    "delivery_photos": (
        f"EXISTS (SELECT 1 FROM deliveries d WHERE d.id = delivery_photos.delivery_id "
        f"AND d.workspace_id = {_WS})"
    ),
    "delivery_photo_comments": (
        f"EXISTS (SELECT 1 FROM delivery_photos p JOIN deliveries d ON d.id = p.delivery_id "
        f"WHERE p.id = delivery_photo_comments.photo_id AND d.workspace_id = {_WS})"
    ),
    "outlets": f"workspace_id = {_WS}",
    "storages": f"workspace_id = {_WS}",
    "stock_levels": f"workspace_id = {_WS}",
    "stock_transfers": f"workspace_id = {_WS}",
    "stock_transfer_lines": (
        f"EXISTS (SELECT 1 FROM stock_transfers t WHERE t.id = stock_transfer_lines.transfer_id "
        f"AND t.workspace_id = {_WS})"
    ),
    "sales": f"workspace_id = {_WS}",
    "sale_lines": f"EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_lines.sale_id AND s.workspace_id = {_WS})",
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
            # One round trip for all the policies: this runs each time the app wakes up.
            # FORCE applies a policy to the table owner too, which is who the app connects as.
            conn.execute("".join(
                f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;"
                f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;"
                f"DROP POLICY IF EXISTS workspace_isolation ON {table};"
                f"CREATE POLICY workspace_isolation ON {table} USING ({condition}) WITH CHECK ({condition});"
                for table, condition in RLS_TABLES.items()
            ))
        finally:
            conn.execute("SELECT pg_advisory_unlock(7461)")


def get_db() -> Iterator[psycopg.Connection]:
    """One pooled connection per request."""
    with _get_pool().connection() as conn:
        try:
            yield conn
        finally:
            # The pool reuses this connection: forget which workspace and user it served.
            if not conn.closed:
                conn.execute("RESET app.workspace_id; RESET app.user_id")


def scope_to_workspace(conn: psycopg.Connection, workspace_id: int) -> None:
    """Tell the database which workspace this connection serves. Reset when the pool takes it back."""
    conn.execute("SELECT set_config('app.workspace_id', %s, false)", (str(workspace_id),))


def scope_to_user(conn: psycopg.Connection, workspace_id: int, user_id: int) -> None:
    """scope_to_workspace, and who is signed in so the audit log ties each action to their account.
    One round trip for both, since every signed-in request does this."""
    conn.execute(
        "SELECT set_config('app.workspace_id', %s, false), set_config('app.user_id', %s, false)",
        (str(workspace_id), str(user_id)),
    )
