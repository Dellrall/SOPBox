"""The receiving journey: check a delivery, hold failures for a manager, log every step.

Every function takes the caller's `workspace_id` and only touches that workspace's rows.
"""

import base64
import json
import re
from datetime import datetime, timezone

import psycopg

from app import catalogue, inbox, locations, purchasing, rules
from app.auditlog import audit
from app.auth import CurrentUser
from app.errors import ConflictError, InvalidRequestError, NotFoundError
from app.models import (
    AuditEntry,
    DecisionIn,
    Delivery,
    DeliveryIn,
    DeliveryLine,
    DeliveryPhoto,
    DeliveryStatus,
    DeliveryTag,
    PhotoComment,
    PhotoCommentIn,
)

ACCEPTED: DeliveryStatus = "accepted"
PENDING: DeliveryStatus = "pending_approval"
REJECTED: DeliveryStatus = "rejected"
RETURNED: DeliveryStatus = "returned"

_DECISION_STATUS: dict[str, DeliveryStatus] = {
    "accept": ACCEPTED,
    "accept_passed": ACCEPTED,
    "reject": REJECTED,
    "return": RETURNED,
}
_DECISION_WORDS = {
    "accept": "accepted",
    "accept_passed": "partly accepted",
    "reject": "rejected",
    "return": "returned to the supplier",
}

# "@olive" or "@sam.k" in a comment; a username starts and ends with a letter or number (see models).
_MENTION = re.compile(r"(?<![\w@])@([a-z0-9][a-z0-9._-]{1,30}[a-z0-9])", re.IGNORECASE)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _add_stock(conn: psycopg.Connection, ws: int, delivery_id: int) -> None:
    """Add what actually arrived to the delivery's storage area. Lines with no base quantity add
    nothing. A delivery from before storage areas goes to the first one."""
    storage = conn.execute("SELECT storage_id FROM deliveries WHERE id = %s", (delivery_id,)).fetchone()["storage_id"]
    storage = storage or locations.default_storage(conn, ws)
    for r in conn.execute(
        "SELECT product_id, SUM(received_base_qty) AS qty FROM delivery_lines "
        "WHERE delivery_id = %s AND product_id IS NOT NULL AND NOT returned AND received_base_qty > 0 "
        "GROUP BY product_id ORDER BY product_id",
        (delivery_id,),
    ).fetchall():
        locations.adjust(conn, ws, r["product_id"], storage, int(r["qty"]))


def _tag(
    conn: psycopg.Connection, ws: int, delivery_id: int, by: CurrentUser, people: dict[int, str], body: str
) -> None:
    """Tag these teammates on the delivery. Only newly tagged people are logged and told."""
    if not people:
        return
    added = [
        r["user_id"]
        for r in conn.execute(
            "INSERT INTO delivery_tags (delivery_id, user_id, tagged_by, created_at) "
            "SELECT %s, unnest(%s::bigint[]), %s, %s ON CONFLICT DO NOTHING RETURNING user_id",
            (delivery_id, list(people), by.display_name, _now()),
        ).fetchall()
    ]
    if not added:
        return
    audit(conn, ws, by.display_name, "delivery.tagged", delivery_id, ", ".join(people[i] for i in sorted(added)))
    inbox.notify(conn, ws, added, "tagged", delivery_id, by.display_name, body, skip=by.id)


def _teammates(conn: psycopg.Connection, ws: int, user_ids: list[int]) -> dict[int, str]:
    people = inbox.members(conn, ws, ids=user_ids)
    unknown = set(user_ids) - set(people)
    if unknown:
        raise InvalidRequestError(f"no active teammate with id {min(unknown)}")
    return people


def _involved(conn: psycopg.Connection, delivery_id: int) -> set[int]:
    """The person who received the delivery and everyone tagged on it."""
    rows = conn.execute(
        "SELECT received_by_id AS id FROM deliveries WHERE id = %s AND received_by_id IS NOT NULL "
        "UNION SELECT user_id FROM delivery_tags WHERE delivery_id = %s",
        (delivery_id, delivery_id),
    ).fetchall()
    return {r["id"] for r in rows}


def create_delivery(
    conn: psycopg.Connection, ws: int, by: CurrentUser, data: DeliveryIn
) -> Delivery:
    """Run the rules on every line. All pass: accepted and stocked. Any fail: wait for a manager."""
    # Archived products cannot be received; their old deliveries still show them.
    products = {p.id: p for p in catalogue.list_products(conn, ws, active_only=True)}
    for line in data.lines:
        if line.product_id is not None and line.product_id not in products:
            raise InvalidRequestError(f"product {line.product_id} is unknown or archived")

    tagged = _teammates(conn, ws, data.tagged_user_ids)
    storage = locations.resolve(conn, ws, data.storage_id)

    with conn.transaction():
        lines = list(data.lines)
        po_issues: list[list[str]] = [[] for _ in lines]
        supplier = data.supplier
        if data.purchase_order_id is not None:
            order = purchasing.outstanding_for_receiving(conn, ws, data.purchase_order_id)
            supplier = supplier or order.supplier
            outstanding = {line.product_id: line.outstanding_base_qty for line in order.lines}
            for i, line in enumerate(lines):
                left = outstanding.get(line.product_id) if line.product_id is not None else None
                if left is None:
                    po_issues[i].append(f"not on {order.reference}")
                elif left == 0:
                    po_issues[i].append(f"nothing left to receive for this product on {order.reference}")
                else:
                    # The order, not the person receiving, says how much is expected.
                    lines[i] = line.model_copy(update={"expected_base_qty": left})

        checks = []
        for line, extra in zip(lines, po_issues):
            check = rules.check_line(products.get(line.product_id), line)
            if extra:
                check = check.model_copy(update={"passed": False, "issues": [*check.issues, *extra]})
            checks.append(check)
        failed = sum(1 for c in checks if not c.passed)
        status = ACCEPTED if failed == 0 else PENDING

        delivery_id = conn.execute(
            "INSERT INTO deliveries (workspace_id, supplier, received_by, received_by_id, status, "
            "created_at, purchase_order_id, storage_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (ws, supplier, by.display_name, by.id, status, _now(), data.purchase_order_id, storage),
        ).fetchone()["id"]
        for line, check in zip(lines, checks):
            conn.execute(
                "INSERT INTO delivery_lines (delivery_id, product_id, name, quantity, unit, temp_c, "
                "expected_base_qty, received_base_qty, passed, issues, unit_price_sen) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    delivery_id,
                    line.product_id,
                    line.name,
                    line.quantity,
                    line.unit,
                    line.temp_c,
                    line.expected_base_qty,
                    check.received_base_qty,
                    check.passed,
                    json.dumps(check.issues),
                    line.unit_price_sen,
                ),
            )
        for photo in data.photos:
            conn.execute(
                "INSERT INTO delivery_photos (delivery_id, data, caption) VALUES (%s, %s, %s)",
                (delivery_id, base64.b64decode(photo.data), photo.caption),
            )
        audit(
            conn,
            ws,
            by.display_name,
            "delivery.received",
            delivery_id,
            f"{len(lines)} line(s), {failed} failed"
            + (f", {len(data.photos)} photo(s)" if data.photos else ""),
        )
        if status == ACCEPTED:
            _add_stock(conn, ws, delivery_id)
            audit(conn, ws, "system", "delivery.accepted", delivery_id, "all checks passed")
        else:
            inbox.notify(
                conn, ws, inbox.approver_ids(conn, ws), "approval_needed", delivery_id, by.display_name,
                f"Delivery #{delivery_id} from {supplier or 'an unknown supplier'} needs approval: "
                f"{failed} line(s) failed their checks.",
                skip=by.id,
            )
        _tag(conn, ws, delivery_id, by, tagged, f"{by.display_name} tagged you on delivery #{delivery_id}.")
    return get_delivery(conn, ws, delivery_id)


def decide(
    conn: psycopg.Connection, ws: int, delivery_id: int, by: CurrentUser, data: DecisionIn
) -> Delivery:
    """A manager accepts, rejects or returns a delivery that is waiting for approval.

    The UPDATE only matches a pending delivery, so two managers deciding at once cannot both win
    and stock cannot be added twice.
    """
    new_status = _DECISION_STATUS[data.decision]
    with conn.transaction():
        cur = conn.execute(
            "UPDATE deliveries SET status = %s, decided_by = %s, decided_at = %s, "
            "decision_reason = %s WHERE id = %s AND workspace_id = %s AND status = %s",
            (new_status, by.display_name, _now(), data.reason or None, delivery_id, ws, PENDING),
        )
        if cur.rowcount == 0:
            exists = conn.execute(
                "SELECT 1 FROM deliveries WHERE id = %s AND workspace_id = %s", (delivery_id, ws)
            ).fetchone()
            if exists is None:
                raise NotFoundError(f"delivery {delivery_id} not found")
            raise ConflictError("this delivery is not waiting for approval")
        action = f"delivery.{new_status}"
        if data.decision == "accept_passed":
            sent_back = conn.execute(
                "UPDATE delivery_lines SET returned = TRUE WHERE delivery_id = %s AND NOT passed "
                "RETURNING name",
                (delivery_id,),
            ).fetchall()
            kept = conn.execute(
                "SELECT 1 FROM delivery_lines WHERE delivery_id = %s AND passed", (delivery_id,)
            ).fetchone()
            if kept is None:
                # Raising rolls back the status change too.
                raise InvalidRequestError("no line passed its checks, so return or reject the delivery")
            action = "delivery.partly_accepted"
            data = data.model_copy(
                update={"reason": f"returned {', '.join(r['name'] for r in sent_back)}: {data.reason}"}
            )
        if new_status == ACCEPTED:
            _add_stock(conn, ws, delivery_id)
        audit(conn, ws, by.display_name, action, delivery_id, data.reason)
        inbox.notify(
            conn, ws, _involved(conn, delivery_id), "decided", delivery_id, by.display_name,
            f"Delivery #{delivery_id} was {_DECISION_WORDS[data.decision]} by {by.display_name}."
            + (f" Reason: {data.reason}" if data.reason else ""),
            skip=by.id,
        )
    return get_delivery(conn, ws, delivery_id)


def _delivery(conn: psycopg.Connection, row: dict) -> Delivery:
    lines = conn.execute(
        "SELECT * FROM delivery_lines WHERE delivery_id = %s ORDER BY id", (row["id"],)
    ).fetchall()
    number = None
    if row.get("purchase_order_id"):
        number = conn.execute(
            "SELECT number FROM purchase_orders WHERE id = %s", (row["purchase_order_id"],)
        ).fetchone()["number"]
    photos = conn.execute(
        "SELECT id, caption FROM delivery_photos WHERE delivery_id = %s ORDER BY id", (row["id"],)
    ).fetchall()
    tags = conn.execute(
        "SELECT t.user_id, u.username, u.display_name, t.tagged_by, t.created_at "
        "FROM delivery_tags t JOIN users u ON u.id = t.user_id WHERE t.delivery_id = %s ORDER BY t.created_at, u.id",
        (row["id"],),
    ).fetchall()
    comments: dict[int, list[PhotoComment]] = {p["id"]: [] for p in photos}
    if photos:
        for c in conn.execute(
            "SELECT id, photo_id, author, body, created_at FROM delivery_photo_comments "
            "WHERE photo_id = ANY(%s) ORDER BY id",
            (list(comments),),
        ).fetchall():
            comments[c["photo_id"]].append(PhotoComment(**c))
    return Delivery(
        **row,
        purchase_order=purchasing.reference(number) if number else None,
        lines=[DeliveryLine(**{**r, "issues": json.loads(r["issues"])}) for r in lines],
        photos=[DeliveryPhoto(**p, comments=comments[p["id"]]) for p in photos],
        tags=[DeliveryTag(**t) for t in tags],
        storage=locations.storage_label(conn, row["workspace_id"], row["storage_id"]) if row.get("storage_id") else None,
    )


def get_photo(conn: psycopg.Connection, ws: int, delivery_id: int, photo_id: int) -> bytes:
    row = conn.execute(
        "SELECT p.data FROM delivery_photos p JOIN deliveries d ON d.id = p.delivery_id "
        "WHERE p.id = %s AND p.delivery_id = %s AND d.workspace_id = %s",
        (photo_id, delivery_id, ws),
    ).fetchone()
    if row is None:
        raise NotFoundError("photo not found")
    return bytes(row["data"])


def comment_on_photo(
    conn: psycopg.Connection, ws: int, delivery_id: int, photo_id: int, by: CurrentUser, data: PhotoCommentIn
) -> Delivery:
    """Save the comment. @mentioned teammates are tagged; everyone else involved hears about it."""
    with conn.transaction():
        get_photo(conn, ws, delivery_id, photo_id)  # 404 unless it is this workspace's
        conn.execute(
            "INSERT INTO delivery_photo_comments (photo_id, author, body, created_at) "
            "VALUES (%s, %s, %s, %s)",
            (photo_id, by.display_name, data.body, _now()),
        )
        audit(conn, ws, by.display_name, "delivery.photo_comment", delivery_id, data.body[:200])
        # Unknown names are just text: a comment never fails over a typo.
        mentioned = inbox.members(conn, ws, usernames=_MENTION.findall(data.body))
        quote = data.body if len(data.body) <= 140 else data.body[:139] + "…"
        others = _involved(conn, delivery_id) - set(mentioned)
        _tag(conn, ws, delivery_id, by, mentioned, f"{by.display_name} mentioned you on delivery #{delivery_id}: “{quote}”")
        inbox.notify(
            conn, ws, others, "comment", delivery_id, by.display_name,
            f"{by.display_name} commented on delivery #{delivery_id}: “{quote}”",
            skip=by.id,
        )
    return get_delivery(conn, ws, delivery_id)


def add_tags(conn: psycopg.Connection, ws: int, delivery_id: int, by: CurrentUser, user_ids: list[int]) -> Delivery:
    with conn.transaction():
        get_delivery(conn, ws, delivery_id)  # 404 unless it is this workspace's
        _tag(conn, ws, delivery_id, by, _teammates(conn, ws, user_ids), f"{by.display_name} tagged you on delivery #{delivery_id}.")
    return get_delivery(conn, ws, delivery_id)


def remove_tag(conn: psycopg.Connection, ws: int, delivery_id: int, by: CurrentUser, user_id: int) -> Delivery:
    with conn.transaction():
        get_delivery(conn, ws, delivery_id)
        row = conn.execute(
            "DELETE FROM delivery_tags t USING users u WHERE t.delivery_id = %s AND t.user_id = %s "
            "AND u.id = t.user_id RETURNING u.display_name",
            (delivery_id, user_id),
        ).fetchone()
        if row is None:
            raise NotFoundError("that teammate is not tagged on this delivery")
        audit(conn, ws, by.display_name, "delivery.untagged", delivery_id, row["display_name"])
    return get_delivery(conn, ws, delivery_id)


def get_delivery(conn: psycopg.Connection, ws: int, delivery_id: int) -> Delivery:
    row = conn.execute(
        "SELECT * FROM deliveries WHERE id = %s AND workspace_id = %s", (delivery_id, ws)
    ).fetchone()
    if row is None:
        raise NotFoundError(f"delivery {delivery_id} not found")
    return _delivery(conn, row)


# Deliveries from before storage areas existed have none: they count as the first outlet's.
_OWN = locations.mine("deliveries.storage_id")


def list_deliveries(
    conn: psycopg.Connection, ws: int, status: DeliveryStatus | None = None, limit: int = 50
) -> list[Delivery]:
    if status:
        rows = conn.execute(
            f"SELECT * FROM deliveries WHERE workspace_id = %s AND status = %s AND {_OWN} "
            "ORDER BY id DESC LIMIT %s",
            (ws, status, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            f"SELECT * FROM deliveries WHERE workspace_id = %s AND {_OWN} ORDER BY id DESC LIMIT %s", (ws, limit)
        ).fetchall()
    return [_delivery(conn, r) for r in rows]


def list_audit(
    conn: psycopg.Connection, ws: int, limit: int = 50, actor_id: int | None = None
) -> list[AuditEntry]:
    rows = conn.execute(
        "SELECT * FROM audit_log WHERE workspace_id = %s AND (%s::bigint IS NULL OR actor_id = %s) "
        f"AND ({locations.OWN_OUTLET} IS NULL OR outlet_id = {locations.OWN_OUTLET}) ORDER BY id DESC LIMIT %s",
        (ws, actor_id, actor_id, limit),
    ).fetchall()
    return [AuditEntry(**r) for r in rows]
