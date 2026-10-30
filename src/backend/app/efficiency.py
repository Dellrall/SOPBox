"""How each person is doing, for managers: jobs done on time, deliveries checked, checks failed
and stock count gaps. Plain counting on saved records; nothing is scored by a model."""

from datetime import date, timedelta

import psycopg

from app import insights
from app.models import Efficiency


def team(conn: psycopg.Connection, ws: int, days: int, today: date | None = None) -> list[Efficiency]:
    today = today or date.today()
    since = today - timedelta(days=days)
    people = conn.execute(
        "SELECT id, display_name, role FROM users WHERE workspace_id = %s AND active "
        "ORDER BY role <> 'owner', lower(display_name)",
        (ws,),
    ).fetchall()
    stats = {p["id"]: dict(jobs_due=0, jobs_on_time=0, late=[], deliveries=0, lines_checked=0, lines_failed=0,
                           counts=0, gap=0.0) for p in people}

    # Orders they were PIC of that were due in the window: on time when the first delivery against
    # the order came in by its expected date.
    for r in conn.execute(
        "SELECT a.user_id, o.expected_date::date AS due, "
        "(SELECT MIN(d.created_at)::date FROM deliveries d WHERE d.purchase_order_id = o.id) AS arrived "
        "FROM assignments a JOIN purchase_orders o ON o.id = a.ref_id AND a.kind = 'po' "
        "WHERE a.workspace_id = %s AND o.status <> 'cancelled' AND o.expected_date::date >= %s AND o.expected_date::date < %s",
        (ws, since, today),
    ).fetchall():
        if r["user_id"] in stats:
            stats[r["user_id"]]["jobs_due"] += 1
            stats[r["user_id"]]["jobs_on_time"] += r["arrived"] is not None and r["arrived"] <= r["due"]
    # Counts they were PIC of: on time when saved by the planned day.
    for r in conn.execute(
        "SELECT a.user_id, c.due_date AS due, s.count_date::date AS done FROM assignments a "
        "JOIN count_plans c ON c.id = a.ref_id AND a.kind = 'count' LEFT JOIN stocktakes s ON s.id = c.stocktake_id "
        "WHERE a.workspace_id = %s AND c.due_date >= %s AND c.due_date < %s",
        (ws, since, today),
    ).fetchall():
        if r["user_id"] in stats:
            stats[r["user_id"]]["jobs_due"] += 1
            stats[r["user_id"]]["jobs_on_time"] += r["done"] is not None and r["done"] <= r["due"]

    for r in conn.execute(
        "SELECT d.received_by_id AS user_id, d.created_at::date AS day, o.expected_date::date AS due, "
        "COUNT(l.id) AS lines, COUNT(l.id) FILTER (WHERE NOT l.passed) AS failed "
        "FROM deliveries d LEFT JOIN purchase_orders o ON o.id = d.purchase_order_id "
        "LEFT JOIN delivery_lines l ON l.delivery_id = d.id "
        "WHERE d.workspace_id = %s AND d.created_at::date >= %s GROUP BY d.id, o.expected_date",
        (ws, since),
    ).fetchall():
        s = stats.get(r["user_id"])
        if s is None:
            continue
        s["deliveries"] += 1
        s["lines_checked"] += r["lines"]
        s["lines_failed"] += r["failed"]
        if r["due"] is not None:
            s["late"].append((r["day"] - r["due"]).days)

    prices = insights.latest_prices(conn, ws)  # sen per base unit
    for r in conn.execute(
        "SELECT s.counted_by_id AS user_id, s.id, l.product_id, l.difference FROM stocktakes s "
        "LEFT JOIN stocktake_lines l ON l.stocktake_id = s.id WHERE s.workspace_id = %s AND s.count_date::date >= %s",
        (ws, since),
    ).fetchall():
        s = stats.get(r["user_id"])
        if s is None:
            continue
        s.setdefault("seen", set()).add(r["id"])
        if r["difference"]:
            s["gap"] += abs(r["difference"]) * prices.get(r["product_id"], 0)

    out = []
    for p in people:
        s = stats[p["id"]]
        counts = len(s.get("seen", ()))
        out.append(Efficiency(
            user_id=p["id"], name=p["display_name"], role=p["role"], jobs_due=s["jobs_due"], jobs_on_time=s["jobs_on_time"],
            deliveries=s["deliveries"], avg_days_late=round(sum(s["late"]) / len(s["late"]), 1) if s["late"] else None,
            lines_checked=s["lines_checked"], lines_failed=s["lines_failed"], counts=counts,
            gap_sen_per_count=round(s["gap"] / counts) if counts else None,
        ))
    return out
