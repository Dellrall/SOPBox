"""Download your data: one ZIP for anyone, whatever their role.

Everyone gets their own account (profile, sign-ins, inbox) as JSON, plus a CSV for each table
behind the sections they can see, so staff get only what their section access shows them and the
owner gets the whole workspace. Row-level security already limits every table to this workspace.
Never included: password, PIN and two-step secrets, session and key hashes, passkey keys, and
photo files (their records are included).
"""

import csv
import io
import json
import zipfile
from datetime import date, datetime, timezone

import psycopg

from app import auth, sales
from app.auth import CurrentUser

# Section (auth.can_access_section) -> the tables it covers.
SECTIONS = {
    "products": ["categories", "products", "pack_units"],
    "records": ["deliveries", "delivery_lines", "delivery_tags", "delivery_photos", "delivery_photo_comments"],
    "purchasing": ["suppliers", "purchase_orders", "purchase_order_lines"],
    "stocktake": [
        "outlets", "storages", "stock_levels", "stocktakes", "stocktake_lines",
        "stock_transfers", "stock_transfer_lines", "sales", "sale_lines",
    ],
    "activity": ["audit_log"],
}
SECRET_COLUMNS = {"token_hash", "password_hash", "pin_hash", "totp_secret", "totp_pending_secret", "code_hash", "public_key", "data"}
TEAM_COLUMNS = "id, username, email, display_name, role, section_access, active, created_at, security_alerts"


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return sales._cell(str(value))


def _csv(rows: list[dict]) -> str:
    out = io.StringIO()
    if rows:
        columns = [c for c in rows[0] if c not in SECRET_COLUMNS]
        writer = csv.writer(out)
        writer.writerow(columns)
        writer.writerows([_text(row[c]) for c in columns] for row in rows)
    return "﻿" + out.getvalue()  # the BOM makes Excel read Malay and Chinese names correctly


def build(conn: psycopg.Connection, user: CurrentUser) -> tuple[str, bytes]:
    """The file name and the ZIP's bytes."""
    me = conn.execute(f"SELECT {TEAM_COLUMNS} FROM users WHERE id = %s", (user.id,)).fetchone()
    mine = {
        "account": me,
        "sign_ins": conn.execute("SELECT at, method, device FROM sign_ins WHERE user_id = %s ORDER BY id", (user.id,)).fetchall(),
        "inbox": conn.execute(
            "SELECT created_at, kind, actor, body, delivery_id FROM notifications WHERE user_id = %s ORDER BY id", (user.id,)
        ).fetchall(),
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("my-account.json", json.dumps(mine, default=_text, ensure_ascii=False, indent=2))
        for section, tables in SECTIONS.items():
            if auth.can_access_section(user, section):
                for table in tables:
                    archive.writestr(f"{table}.csv", _csv(conn.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()))
        if user.role in ("owner", "manager"):
            team = conn.execute(f"SELECT {TEAM_COLUMNS} FROM users WHERE workspace_id = %s ORDER BY id", (user.workspace_id,))
            archive.writestr("team.csv", _csv(team.fetchall()))
            keys = conn.execute(
                "SELECT id, name, hint, storage_id, created_by, created_at, last_used_at FROM api_keys "
                "WHERE workspace_id = %s ORDER BY id",
                (user.workspace_id,),
            )
            archive.writestr("api_keys.csv", _csv(keys.fetchall()))
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"sopbox-export-{user.workspace_id}-{stamp}.zip", buffer.getvalue()
