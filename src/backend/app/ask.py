"""Questions people can ask the helper, each answered from the records by a fixed query.

The question picks a topic: first by its words (instant, in English or Malay), and only when that
fails by the model (extraction.pick_topic). The model never sees the records and never writes the
answer, so an answer is only ever what the query found. Each topic needs the section its records
belong to, the same access the page with the details needs.
"""

import re
from datetime import date, timedelta

import psycopg

from app import auth, catalogue, insights, purchasing
from app.auth import CurrentUser
from app.errors import ExtractionError, RateLimitError
from app.extraction import pick_topic
from app.models import AskAnswer

# Matched in this order: "orders waiting for approval" is about approvals, not reordering.
TOPICS = ("waste", "approvals", "prices", "reorder", "use")
SECTION = {"waste": "stocktake", "reorder": "purchasing", "prices": "purchasing", "approvals": "approvals", "use": "stocktake"}
PAGE = {"waste": "stocktake", "reorder": "purchasing", "prices": "dashboard", "approvals": "approvals", "use": "stocktake"}
_WORDS = {
    "waste": r"wast|short|missing|lost|loss|gap|theft|rugi|buang|hilang|kurang",
    "reorder": r"reorder|order|running (low|out)|low stock|buy|restock|beli|pesan|habis|stok",
    "prices": r"price|cost|expensive|cheaper|supplier rais|harga|mahal|naik",
    "approvals": r"approv|pending|waiting|decide|lulus|tunggu",
    "use": r"how (fast|much|many|long)|\buse[ds]?\b|\blast\b|guna|tahan",
}
HELP = "I can answer: what went missing at counts, what to reorder, which prices changed, what waits for approval, and how fast a product is used."
MAX_ITEMS = 5


def _rm(sen: float) -> str:
    return f"RM{sen / 100:,.2f}"


def _product(conn: psycopg.Connection, ws: int, question: str, named: str | None):
    """The product the question names: the model's pick if it is a real product, else the longest
    product name found in the question."""
    products = catalogue.list_products(conn, ws, active_only=True)
    text = question.casefold()
    if named:
        found = [p for p in products if p.name.casefold() == named.casefold().strip()]
        if found:
            return found[0]
    found = [p for p in products if p.name.casefold() in text]
    return max(found, key=lambda p: len(p.name)) if found else None


def _waste(conn: psycopg.Connection, ws: int, days: int) -> AskAnswer:
    since = date.today() - timedelta(days=days)
    rows = conn.execute(
        "SELECT l.product_id, l.product_name, l.base_unit, SUM(-l.difference)::bigint AS missing "
        "FROM stocktake_lines l JOIN stocktakes s ON s.id = l.stocktake_id "
        "WHERE s.workspace_id = %s AND s.count_date > %s AND l.difference < 0 "
        "GROUP BY l.product_id, l.product_name, l.base_unit",
        (ws, since),
    ).fetchall()
    if not rows:
        return AskAnswer(topic="waste", text=f"No count came up short in the last {days} days.", to=PAGE["waste"])
    price = insights.latest_prices(conn, ws)
    value = {r["product_id"]: r["missing"] * price[r["product_id"]] for r in rows if r["product_id"] in price}
    rows.sort(key=lambda r: (-value.get(r["product_id"], 0), -r["missing"]))
    items = [
        f"{r['product_name']}: {r['missing']} {r['base_unit']} missing"
        + (f" (about {_rm(value[r['product_id']])})" if r["product_id"] in value else "")
        for r in rows[:MAX_ITEMS]
    ]
    total = f" Priced items come to about {_rm(sum(value.values()))}." if value else ""
    return AskAnswer(
        topic="waste",
        text=f"{len(rows)} {'product' if len(rows) == 1 else 'products'} came up short at counts in the last {days} days.{total}",
        items=items,
        to=PAGE["waste"],
    )


def _reorder(conn: psycopg.Connection, ws: int) -> AskAnswer:
    need = [s for s in purchasing.reorder_suggestions(conn, ws)[0] if s.quantity > 0]
    if not need:
        return AskAnswer(topic="reorder", text="Nothing needs ordering: every product has its minimum and a week of use, or is already on order.", to=PAGE["reorder"])
    return AskAnswer(
        topic="reorder",
        text=f"{len(need)} {'product needs' if len(need) == 1 else 'products need'} ordering. Draft from low stock on Purchase orders makes the order.",
        items=[f"{s.product_name}: {s.quantity} {s.base_unit}. {s.reason}" for s in need[:MAX_ITEMS]],
        to=PAGE["reorder"],
    )


def _prices(conn: psycopg.Connection, ws: int) -> AskAnswer:
    changes = insights.price_changes(conn, ws)
    if not changes:
        return AskAnswer(topic="prices", text=f"No delivered price moved by {insights.PRICE_STEP:.0%} or more in the last {insights.PRICE_DAYS} days.", to=PAGE["prices"])
    return AskAnswer(
        topic="prices",
        text=f"{len(changes)} {'price' if len(changes) == 1 else 'prices'} changed in the last {insights.PRICE_DAYS} days.",
        items=[
            f"{c.product_name}{f' from {c.supplier}' if c.supplier else ''}: {'up' if c.change > 0 else 'down'} {abs(c.change):.0%}, "
            f"{_rm(c.before_sen)} to {_rm(c.now_sen)} per {c.base_unit}"
            for c in changes[:MAX_ITEMS]
        ],
        to=PAGE["prices"],
    )


def _approvals(conn: psycopg.Connection, ws: int) -> AskAnswer:
    rows = conn.execute(
        "SELECT supplier, received_by, created_at FROM deliveries WHERE workspace_id = %s AND status = 'pending_approval' "
        "ORDER BY created_at",
        (ws,),
    ).fetchall()
    if not rows:
        return AskAnswer(topic="approvals", text="No delivery is waiting for a manager.", to=PAGE["approvals"])
    return AskAnswer(
        topic="approvals",
        text=f"{len(rows)} {'delivery is' if len(rows) == 1 else 'deliveries are'} waiting for a manager.",
        items=[f"{r['supplier'] or 'No supplier named'}, received by {r['received_by']} on {r['created_at'][:10]}" for r in rows[:MAX_ITEMS]],
        to=PAGE["approvals"],
    )


def _use(conn: psycopg.Connection, ws: int, question: str, named: str | None) -> AskAnswer:
    product = _product(conn, ws, question, named)
    if product is None:
        return AskAnswer(topic="use", text="Which product? Ask again with its name as it is in Products, e.g. \"How fast do we use rice?\"")
    rate = insights.daily_use(conn, ws).get(product.id, 0)
    if not rate:
        return AskAnswer(
            topic="use",
            text=f"No use of {product.name} is recorded in the last {insights.USAGE_DAYS} days. Use shows up from uploaded sales and from count shortfalls.",
            to=PAGE["use"],
        )
    unit = product.base_unit
    return AskAnswer(
        topic="use",
        text=f"{product.name}: about {rate:.1f} {unit} a day lately. {product.stock} {unit} on hand lasts about {product.stock / rate:.1f} days.",
        to=PAGE["use"],
    )


def answer(conn: psycopg.Connection, user: CurrentUser, question: str) -> AskAnswer:
    text = question.casefold()
    topic = next((t for t in TOPICS if re.search(_WORDS[t], text)), None)
    product, days = None, None
    if topic is None:
        try:
            topic, product, days = pick_topic(question, TOPICS)
        except (ExtractionError, RateLimitError):
            topic = None
    if topic not in TOPICS:
        return AskAnswer(topic="help", text=HELP)
    if not auth.can_access_section(user, SECTION[topic]):
        return AskAnswer(topic="help", text="That needs access you do not have here. Ask a manager.")
    ws = user.workspace_id
    if topic == "waste":
        return _waste(conn, ws, days or (7 if re.search(r"week|minggu", text) else 30))
    if topic == "reorder":
        return _reorder(conn, ws)
    if topic == "prices":
        return _prices(conn, ws)
    if topic == "approvals":
        return _approvals(conn, ws)
    return _use(conn, ws, question, product)
