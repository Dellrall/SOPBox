import sqlite3
from collections.abc import Iterator

from app.config import get_settings

# SQLite is the fallback named in the proposal: no setup, no cost, and enough for the demo.
# Quantities are stored in base units (see rules.to_base_units).
SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    temp_min_c REAL,
    temp_max_c REAL
);
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    base_unit TEXT NOT NULL,
    temp_min_c REAL,
    temp_max_c REAL,
    min_stock INTEGER NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    sop TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS pack_units (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit TEXT NOT NULL COLLATE NOCASE,
    base_qty INTEGER NOT NULL CHECK (base_qty > 0),
    PRIMARY KEY (product_id, unit)
);
CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier TEXT NOT NULL DEFAULT '',
    received_by TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('accepted', 'pending_approval', 'rejected', 'returned')),
    created_at TEXT NOT NULL,
    decided_by TEXT,
    decided_at TEXT,
    decision_reason TEXT
);
CREATE TABLE IF NOT EXISTS delivery_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id),
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit TEXT NOT NULL,
    temp_c REAL,
    expected_base_qty INTEGER,
    received_base_qty INTEGER,
    passed INTEGER NOT NULL,
    issues TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    delivery_id INTEGER,
    detail TEXT NOT NULL DEFAULT ''
);
"""


def connect() -> sqlite3.Connection:
    # check_same_thread=False: FastAPI may run a request's dependency and handler on different
    # worker threads. A connection is only ever used by one request at a time.
    conn = sqlite3.connect(get_settings().db_path, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        with conn:
            conn.executescript(SCHEMA)
    finally:
        conn.close()


def get_db() -> Iterator[sqlite3.Connection]:
    """One connection per request. Writers commit themselves with `with conn:`."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
