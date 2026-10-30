"""What the stock records say: where counts keep coming up short, what to reorder, and which
delivered prices moved.

Everything here is plain arithmetic on saved records, so it works with the model switched off.
The model only puts a count's gaps into words (extraction.explain_gaps), from the numbers worked
out here.
"""

import math
from datetime import date, timedelta

import psycopg

from app import stocktakes
from app.errors import NotFoundError
from app.models import CountGap, CountInsights, PriceChange, Product, ReorderSuggestion

EARLIER_COUNTS = 4  # earlier counts of the same storage area compared with this one
REPEAT_SHORT = 2  # this many of them short as well makes a gap a repeat
USAGE_DAYS = 28  # recent use is measured over this window
MIN_USAGE_DAYS = 7  # a younger record is still spread over a week, so one busy day is not a trend
COVER_DAYS = 7  # a suggested order lasts this long at recent use, on top of the minimum
FORECAST_WEEKS = 8  # the sales trend is read from this many full weeks
MIN_FORECAST_WEEKS = 3  # fewer weeks of sales is too little to call a trend
PRICE_DAYS = 30  # price changes delivered in this window are shown
PRICE_STEP = 0.10  # a change of at least this share is worth a manager's look

# Delivered lines with a price, oldest first, and that price per base unit. A line not matched to
# a product, or with nothing received in base units, has no price per base unit to compare.
_PRICED_LINES = """
SELECT l.product_id, p.name AS product_name, p.base_unit, d.id AS delivery_id, d.supplier, d.created_at,
       l.unit_price_sen::float8 * l.quantity / l.received_base_qty AS per_base
FROM delivery_lines l JOIN deliveries d ON d.id = l.delivery_id JOIN products p ON p.id = l.product_id
WHERE d.workspace_id = %s AND d.status IN ('accepted', 'pending_approval') AND NOT l.returned
  AND l.unit_price_sen IS NOT NULL AND l.received_base_qty > 0
ORDER BY d.created_at, d.id, l.id
"""


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

    price = latest_prices(conn, ws)
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
            value_sen=round(l.difference * price[l.product_id]) if l.product_id in price else None,
        ))
    rank = {"repeat": 0, "one_off": 1, "over": 2}
    gaps.sort(key=lambda g: (rank[g.pattern], -abs(g.share or 0), g.product_name.lower()))
    return CountInsights(
        stocktake_id=head["id"], reference=head["reference"], sales_recorded=sales_recorded, gaps=gaps
    )


def _use(conn: psycopg.Connection, ws: int, today: date) -> tuple[dict[int, int], dict[int, int], int]:
    """Base units sold and found missing at counts per product lately, and the days that covers.
    Extra found at a count (often the first count, or a delivery not entered) is not negative use,
    so it is left out. Transfers between storage areas move stock, not use it."""
    since = today - timedelta(days=USAGE_DAYS)
    sold: dict[int, int] = {}
    lost: dict[int, int] = {}
    first: date | None = None
    for row in conn.execute(
        "SELECT sl.product_id, SUM(sl.deducted)::bigint AS q, MIN(s.sale_date) AS first FROM sale_lines sl "
        "JOIN sales s ON s.id = sl.sale_id WHERE s.workspace_id = %s AND s.sale_date > %s "
        "AND sl.product_id IS NOT NULL GROUP BY sl.product_id",
        (ws, since),
    ).fetchall():
        sold[row["product_id"]] = row["q"]
        first = min(first or row["first"], row["first"])
    for row in conn.execute(
        "SELECT l.product_id, SUM(-l.difference)::bigint AS q, MIN(s.count_date) AS first FROM stocktake_lines l "
        "JOIN stocktakes s ON s.id = l.stocktake_id WHERE s.workspace_id = %s AND s.count_date > %s "
        "AND l.product_id IS NOT NULL AND l.difference < 0 GROUP BY l.product_id",
        (ws, since),
    ).fetchall():
        lost[row["product_id"]] = row["q"]
        first = min(first or row["first"], row["first"])
    if first is None:
        return {}, {}, 0
    return sold, lost, min(USAGE_DAYS, max(MIN_USAGE_DAYS, (today - first).days + 1))


def daily_use(conn: psycopg.Connection, ws: int, today: date | None = None) -> dict[int, float]:
    """Base units each product used a day lately: what sales took off, plus what counts found missing."""
    sold, lost, days = _use(conn, ws, today or date.today())
    used = {pid: sold.get(pid, 0) + lost.get(pid, 0) for pid in sold.keys() | lost.keys()}
    return {pid: q / days for pid, q in used.items() if q > 0}


def daily_sales(conn: psycopg.Connection, ws: int, today: date | None = None) -> dict[int, float]:
    """The sales part of daily_use, which a forecast replaces."""
    sold, _, days = _use(conn, ws, today or date.today())
    return {pid: q / days for pid, q in sold.items() if q > 0}


def trend(weeks: list[float]) -> float | None:
    """Next week's sales from a straight line through the weekly totals (oldest first).

    Kept between half and double the last four weeks' average, so one odd week cannot send an
    order wild. None with fewer than MIN_FORECAST_WEEKS weeks.
    """
    n = len(weeks)
    if n < MIN_FORECAST_WEEKS:
        return None
    mean_x, mean_y = (n - 1) / 2, sum(weeks) / n
    slope = sum((x - mean_x) * (y - mean_y) for x, y in enumerate(weeks)) / sum((x - mean_x) ** 2 for x in range(n))
    recent = sum(weeks[-4:]) / len(weeks[-4:])
    return min(max(mean_y + slope * (n - mean_x), recent / 2), recent * 2)


def sales_forecast(conn: psycopg.Connection, ws: int, today: date | None = None) -> dict[int, float]:
    """Each product's expected sales over the next COVER_DAYS, from its weekly sales trend.

    Weeks end yesterday. Only full weeks since the product's first sale in the window count, so a
    product sold for two weeks is not read as zero for the six before.
    """
    today = today or date.today()
    since = today - timedelta(days=7 * FORECAST_WEEKS)
    weekly: dict[int, list[float]] = {}
    for row in conn.execute(
        "SELECT sl.product_id, s.sale_date, SUM(sl.quantity)::bigint AS q, "
        "MIN(MIN(s.sale_date)) OVER (PARTITION BY sl.product_id) AS first "
        "FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id "
        "WHERE s.workspace_id = %s AND s.sale_date >= %s AND s.sale_date < %s AND sl.product_id IS NOT NULL "
        "GROUP BY sl.product_id, s.sale_date",
        (ws, since, today),
    ).fetchall():
        full = min(FORECAST_WEEKS, (today - row["first"]).days // 7)
        if full < MIN_FORECAST_WEEKS:
            continue
        weeks = weekly.setdefault(row["product_id"], [0.0] * full)
        back = (today - timedelta(days=1) - row["sale_date"]).days // 7  # 0 is the week just ended
        if back < full:
            weeks[full - 1 - back] += row["q"]
    return {pid: f for pid, weeks in weekly.items() if (f := trend(weeks)) is not None}


def _amount(value: float) -> str:
    return f"{value:.0f}" if value >= 10 or value == int(value) else f"{value:.1f}"


def reorder(
    products: list[Product],
    use: dict[int, float],
    on_order: dict[int, int],
    forecast: dict[int, float] | None = None,
    sales: dict[int, float] | None = None,
) -> list[ReorderSuggestion]:
    """Each product that needs more than it has: COVER_DAYS of recent use plus its minimum.

    With a sales `forecast` for the product, it replaces the recent sales part of its use (`sales`,
    a day) for those days; count losses still count at their recent rate.
    `quantity` is net of open orders and may be 0 when they already cover it; the product is
    still listed, so the caller can say which order covers it.
    """
    forecast, sales = forecast or {}, sales or {}
    out = []
    for p in products:
        rate = use.get(p.id, 0.0)
        expected = forecast.get(p.id)
        flat = sales.get(p.id, 0.0) * COVER_DAYS
        cover = rate * COVER_DAYS if expected is None else rate * COVER_DAYS - flat + expected
        need = math.ceil(cover) + p.min_stock - p.stock
        if need <= 0:
            continue
        ordered = on_order.get(p.id, 0)
        unit = p.base_unit
        if rate:
            reason = f"Uses about {_amount(rate)} {unit} a day; {p.stock} {unit} lasts about {_amount(p.stock / rate)} days."
            reason += f" Orders {COVER_DAYS} days of use" + (f" plus the minimum of {p.min_stock}." if p.min_stock else ".")
        else:
            reason = f"Below its minimum of {p.min_stock} {unit}."
        if expected is not None:
            way = " Sales are rising:" if expected > flat * 1.1 else " Sales are falling:" if expected < flat * 0.9 else ""
            reason += f"{way} about {_amount(expected)} {unit} expected to sell in the next {COVER_DAYS} days."
        if ordered:
            reason += f" {ordered} {unit} already on order."
        out.append(ReorderSuggestion(
            product_id=p.id, product_name=p.name, base_unit=unit, stock=p.stock, min_stock=p.min_stock,
            daily_use=round(rate, 2), days_left=round(p.stock / rate, 1) if rate else None,
            on_order=ordered, quantity=max(0, need - ordered), reason=reason,
        ))
    return sorted(out, key=lambda s: (s.days_left if s.days_left is not None else -1, s.product_name.lower()))


def latest_prices(conn: psycopg.Connection, ws: int) -> dict[int, float]:
    """Each product's latest delivered price per base unit, in sen."""
    return {row["product_id"]: row["per_base"] for row in conn.execute(_PRICED_LINES, (ws,)).fetchall()}


def price_changes(conn: psycopg.Connection, ws: int, today: date | None = None) -> list[PriceChange]:
    """Products whose latest delivered price, within PRICE_DAYS, moved by PRICE_STEP or more from
    the delivery before it. Biggest rise first."""
    since = (today or date.today()) - timedelta(days=PRICE_DAYS)
    last: dict[int, dict] = {}
    changes: dict[int, PriceChange] = {}
    for row in conn.execute(_PRICED_LINES, (ws,)).fetchall():
        before = last.get(row["product_id"])
        last[row["product_id"]] = row
        if before is None or before["delivery_id"] == row["delivery_id"] or not before["per_base"]:
            continue
        change = row["per_base"] / before["per_base"] - 1
        changes.pop(row["product_id"], None)  # only the latest delivery counts
        if abs(change) >= PRICE_STEP and date.fromisoformat(row["created_at"][:10]) > since:
            changes[row["product_id"]] = PriceChange(
                product_id=row["product_id"], product_name=row["product_name"], base_unit=row["base_unit"],
                supplier=row["supplier"], before_sen=round(before["per_base"], 2), now_sen=round(row["per_base"], 2),
                change=round(change, 3), delivery_id=row["delivery_id"], received_at=row["created_at"],
                previous_at=before["created_at"],
            )
    return sorted(changes.values(), key=lambda c: -c.change)
