"""What the stock records say: where counts keep coming up short, and what to reorder.

Everything here is plain arithmetic on saved records, so it works with the model switched off.
The model only puts a count's gaps into words (extraction.explain_gaps), from the numbers worked
out here.
"""

import math
from datetime import date, timedelta

import psycopg

from app import stocktakes
from app.errors import NotFoundError
from app.models import CountGap, CountInsights, Product, ReorderSuggestion

EARLIER_COUNTS = 4  # earlier counts of the same storage area compared with this one
REPEAT_SHORT = 2  # this many of them short as well makes a gap a repeat
USAGE_DAYS = 28  # recent use is measured over this window
MIN_USAGE_DAYS = 7  # a younger record is still spread over a week, so one busy day is not a trend
COVER_DAYS = 7  # a suggested order lasts this long at recent use, on top of the minimum


def _hint(pattern: str, earlier: list[int], sales_recorded: bool) -> str:
    if pattern == "over":
        return "More was found than expected: a delivery or transfer not entered, or a miscount last time."
    if pattern == "repeat":
        short = sum(d < 0 for d in earlier)
        return (
            f"Short again: {short} of the last {len(earlier)} counts were short too. "
            "Check portion sizes, spoilage and who can reach this stock."
        )
    if not sales_recorded:
        return (
            "No sales are recorded for this storage area, so normal use shows up as a gap. "
            "Upload sales to tell use apart from waste."
        )
    return "A one-off gap: check deliveries, returns and anything thrown away since the last count."


def count_insights(conn: psycopg.Connection, ws: int, stocktake_id: int) -> CountInsights:
    """The count's gaps, repeat shortfalls first, then the largest share of what was expected."""
    head = conn.execute(
        "SELECT id, reference, storage_id, count_date FROM stocktakes WHERE workspace_id = %s AND id = %s",
        (ws, stocktake_id),
    ).fetchone()
    if head is None:
        raise NotFoundError("stocktake not found")
    lines = [l for l in stocktakes.get_stocktake(conn, ws, stocktake_id).lines if l.difference != 0]

    earlier: dict[int, list[int]] = {}
    for row in conn.execute(
        "SELECT l.product_id, l.difference FROM stocktake_lines l JOIN stocktakes s ON s.id = l.stocktake_id "
        "WHERE s.workspace_id = %s AND s.storage_id IS NOT DISTINCT FROM %s AND l.product_id = ANY(%s) "
        "AND (s.count_date, s.id) < (%s, %s) ORDER BY s.count_date DESC, s.id DESC",
        (ws, head["storage_id"], [l.product_id for l in lines if l.product_id], head["count_date"], head["id"]),
    ).fetchall():
        found = earlier.setdefault(row["product_id"], [])
        if len(found) < EARLIER_COUNTS:
            found.append(row["difference"])

    sales_recorded = conn.execute(
        "SELECT EXISTS (SELECT 1 FROM sales WHERE workspace_id = %s AND storage_id IS NOT DISTINCT FROM %s "
        "AND sale_date BETWEEN %s AND %s) AS any",
        (ws, head["storage_id"], head["count_date"] - timedelta(days=USAGE_DAYS), head["count_date"]),
    ).fetchone()["any"]

    gaps = []
    for l in lines:
        before = earlier.get(l.product_id, []) if l.product_id else []
        if l.difference > 0:
            pattern = "over"
        elif sum(d < 0 for d in before) >= REPEAT_SHORT:
            pattern = "repeat"
        else:
            pattern = "one_off"
        gaps.append(CountGap(
            **l.model_dump(exclude={"id"}),
            share=round(l.difference / l.expected_stock, 3) if l.expected_stock else None,
            earlier=before,
            pattern=pattern,
            hint=_hint(pattern, before, sales_recorded),
        ))
    rank = {"repeat": 0, "one_off": 1, "over": 2}
    gaps.sort(key=lambda g: (rank[g.pattern], -abs(g.share or 0), g.product_name.lower()))
    return CountInsights(
        stocktake_id=head["id"], reference=head["reference"], sales_recorded=sales_recorded, gaps=gaps
    )


def daily_use(conn: psycopg.Connection, ws: int, today: date | None = None) -> dict[int, float]:
    """Base units each product used a day lately: what sales took off, plus what counts found
    missing. Extra found at a count (often the first count, or a delivery not entered) is not
    negative use, so it is left out. Transfers between storage areas move stock, not use it."""
    today = today or date.today()
    since = today - timedelta(days=USAGE_DAYS)
    used: dict[int, int] = {}
    first: date | None = None
    for row in conn.execute(
        "SELECT sl.product_id, SUM(sl.deducted)::bigint AS q, MIN(s.sale_date) AS first FROM sale_lines sl "
        "JOIN sales s ON s.id = sl.sale_id WHERE s.workspace_id = %s AND s.sale_date > %s "
        "AND sl.product_id IS NOT NULL GROUP BY sl.product_id",
        (ws, since),
    ).fetchall():
        used[row["product_id"]] = used.get(row["product_id"], 0) + row["q"]
        first = min(first or row["first"], row["first"])
    for row in conn.execute(
        "SELECT l.product_id, SUM(-l.difference)::bigint AS q, MIN(s.count_date) AS first FROM stocktake_lines l "
        "JOIN stocktakes s ON s.id = l.stocktake_id WHERE s.workspace_id = %s AND s.count_date > %s "
        "AND l.product_id IS NOT NULL AND l.difference < 0 GROUP BY l.product_id",
        (ws, since),
    ).fetchall():
        used[row["product_id"]] = used.get(row["product_id"], 0) + row["q"]
        first = min(first or row["first"], row["first"])
    if first is None:
        return {}
    days = min(USAGE_DAYS, max(MIN_USAGE_DAYS, (today - first).days + 1))
    return {pid: q / days for pid, q in used.items() if q > 0}


def _amount(value: float) -> str:
    return f"{value:.0f}" if value >= 10 or value == int(value) else f"{value:.1f}"


def reorder(products: list[Product], use: dict[int, float], on_order: dict[int, int]) -> list[ReorderSuggestion]:
    """Each product that needs more than it has: COVER_DAYS of recent use plus its minimum.

    `quantity` is net of open orders and may be 0 when they already cover it; the product is
    still listed, so the caller can say which order covers it.
    """
    out = []
    for p in products:
        rate = use.get(p.id, 0.0)
        need = math.ceil(rate * COVER_DAYS) + p.min_stock - p.stock
        if need <= 0:
            continue
        ordered = on_order.get(p.id, 0)
        unit = p.base_unit
        if rate:
            reason = f"Uses about {_amount(rate)} {unit} a day; {p.stock} {unit} lasts about {_amount(p.stock / rate)} days."
            reason += f" Orders {COVER_DAYS} days of use" + (f" plus the minimum of {p.min_stock}." if p.min_stock else ".")
        else:
            reason = f"Below its minimum of {p.min_stock} {unit}."
        if ordered:
            reason += f" {ordered} {unit} already on order."
        out.append(ReorderSuggestion(
            product_id=p.id, product_name=p.name, base_unit=unit, stock=p.stock, min_stock=p.min_stock,
            daily_use=round(rate, 2), days_left=round(p.stock / rate, 1) if rate else None,
            on_order=ordered, quantity=max(0, need - ordered), reason=reason,
        ))
    return sorted(out, key=lambda s: (s.days_left if s.days_left is not None else -1, s.product_name.lower()))
