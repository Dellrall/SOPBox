"""Plans: Free for one store, Pro for more, Enterprise by talking to sales.

Every price, link and contact detail SOPBox shows lives at the top of this file; None prints as
"TBC". Payments are not taken in the app yet: an owner sends an upgrade request, and the team turns
the plan on (`python -m app.set_plan`, later the internal operations site), or gives the owner a
code (`python -m app.plan_codes`) to enter in Settings, Plan & billing.

- Free: one outlet (any number of storage areas in it), the whole team, AI reading, stock, sales.
- Pro: a monthly price with its first outlet plus one per extra outlet, paid yearly; HQ branch links,
  till API keys. Add-ons: customization (custom work, quoted per task) and priority support (yearly).
- Enterprise: a price agreed with sales, from a listed starting price; everything on.
Workspaces from before plans are pre-alpha users: what they already set up keeps working, and
adding more follows their plan. An annual plan that has run out counts as Free (nothing is deleted).
"""

from collections.abc import Callable
from datetime import date, timedelta
from typing import TypeVar

import psycopg

from app.auditlog import audit
from app.auth import CurrentUser, token_digest
from app.errors import ConflictError, ForbiddenError, InvalidRequestError
from app.models import PlanOut, PricingOut

T = TypeVar("T")

CURRENCY = "RM"
# Launch prices hold for an early customer's first 12 months; "_later" is the list price after that.
PRICES: dict[str, int | None] = {
    "pro_month": 49,  # Pro, a month with work recorded at its first outlet; a quiet month costs 0
    "pro_month_later": 89,
    "pro_outlet_month": 29,  # each further outlet with work recorded that month
    "pro_outlet_month_later": 49,
    "pro_outlet_year": 348,  # the same extra outlet, paid for the year
    "pro_outlet_lifetime": 2990,  # once per outlet, approved by the team; then only AI reading is charged
    "ai_read_sen": 30,  # one AI reading (delivery order, product sheet, SOP writer) on a lifetime plan
    "customization_year": None,  # custom work is quoted per task instead
    "customization_lifetime": None,
    "custom_task_from": 100,  # smallest custom job, quoted before work starts
    "priority_support_year": 190,  # free in an early customer's first year
    "enterprise_month_from": None,  # agreed with sales
}
FREE_PRODUCTS = 50  # products a Free workspace can hold (archived ones do not count)
# AI uses a month: order and product-sheet photos, the SOP writer, count explanations, sales reading.
# One use costs us roughly RM 0.10-0.30, so each allowance stays well under what the plan brings in.
# Pro's is per outlet on the plan; lifetime plans pay per use (ai_read_sen) and Enterprise is agreed.
AI_MONTH = {"free": 30, "pro": 150}
FREE_SALES_AI = 10  # of Free's 30, sales reading (a try; Pro reads sales freely within its allowance)
KOFI_URL = ""  # e.g. https://ko-fi.com/sopbox; the Donate button shows once set
SALES_EMAIL = ""
SALES_PHONE = ""

LABEL = {"free": "Free", "pro": "Pro", "enterprise": "Enterprise"}
UPGRADE = "your plan does not include this: see Settings, Plan & billing"


def pricing() -> PricingOut:
    return PricingOut(
        currency=CURRENCY,
        prices={**PRICES, "free_products": FREE_PRODUCTS, "free_ai_month": AI_MONTH["free"],
                "pro_ai_month": AI_MONTH["pro"], "free_sales_ai": FREE_SALES_AI},
        kofi_url=KOFI_URL,
        sales_email=SALES_EMAIL, sales_phone=SALES_PHONE,
    )


# Work that counts as using SOPBox in a month; signing in or changing settings does not.
USAGE_ACTIONS = ("delivery", "po", "stocktake", "stock", "sales", "lot", "task_list", "assignment", "count")


def monthly_bill_sen(active_outlets: int) -> int | None:
    """Pro by use: nothing in a month with no work, else the first outlet plus each further active one."""
    base, extra = PRICES["pro_month"], PRICES["pro_outlet_month"]
    if base is None or extra is None:
        return None
    return 0 if active_outlets == 0 else (base + (active_outlets - 1) * extra) * 100


def active_outlets(conn: psycopg.Connection, ws: int, today: date | None = None) -> int:
    """Outlets with work recorded this calendar month. Entries from before outlets count as the first."""
    start = (today or date.today()).replace(day=1).isoformat()
    return conn.execute(
        "SELECT count(DISTINCT COALESCE(outlet_id, (SELECT min(id) FROM outlets WHERE workspace_id = %s))) AS n "
        "FROM audit_log WHERE workspace_id = %s AND at >= %s AND split_part(action, '.', 1) = ANY(%s)",
        (ws, ws, start, list(USAGE_ACTIONS)),
    ).fetchone()["n"]


def _ai_allowed(plan: str, billing: str | None, outlets_allowed: int | None) -> int | None:
    if plan == "enterprise" or billing == "lifetime":
        return None
    return AI_MONTH[plan] * (outlets_allowed or 1)


def _ai_used(conn: psycopg.Connection, ws: int, feature: str | None = None) -> int:
    return conn.execute(
        "SELECT count(*) AS n FROM ai_uses WHERE workspace_id = %s AND at >= date_trunc('month', now()) "
        "AND (%s::text IS NULL OR feature = %s)",
        (ws, feature, feature),
    ).fetchone()["n"]


def metered(conn: psycopg.Connection, ws: int, feature: str, call: Callable[[], T]) -> T:
    """Run one paid AI call within the plan's monthly allowance. Only a call that worked is counted."""
    plan = current(conn, ws)
    if plan.ai_allowed is not None and plan.ai_used >= plan.ai_allowed:
        raise ForbiddenError(
            f"this month's {plan.ai_allowed} AI uses are used up: type it in by hand, or see Settings, Plan & billing"
        )
    if plan.plan == "free" and feature == "sales" and _ai_used(conn, ws, "sales") >= FREE_SALES_AI:
        raise ForbiddenError(
            f"the Free plan reads sales with AI {FREE_SALES_AI} times a month: match the lines by hand, "
            "or see Settings, Plan & billing"
        )
    result = call()
    conn.execute("INSERT INTO ai_uses (workspace_id, feature) VALUES (%s, %s)", (ws, feature))
    return result


def current(conn: psycopg.Connection, ws: int) -> PlanOut:
    row = conn.execute(
        "SELECT plan, plan_billing, plan_until, paid_outlets, customization, priority_support_until, pre_alpha, "
        "(SELECT count(*) FROM outlets WHERE workspace_id = w.id) AS outlets_used FROM workspaces w WHERE id = %s",
        (ws,),
    ).fetchone()
    today = date.today()
    lapsed = row["plan_billing"] == "annual" and (row["plan_until"] is None or row["plan_until"] < today)
    plan = "free" if lapsed else row["plan"]
    paid = plan != "free"
    outlets_allowed = None if plan == "enterprise" else 1 + (row["paid_outlets"] if paid else 0)
    return PlanOut(
        plan=plan,
        label=LABEL[plan],
        pre_alpha=row["pre_alpha"],
        billing=row["plan_billing"] if paid else None,
        until=row["plan_until"] if paid else None,
        lapsed=lapsed and row["plan"] != "free",
        outlets_allowed=outlets_allowed,
        outlets_used=row["outlets_used"],
        api_access=paid,
        hq_links=paid,
        customization=plan == "enterprise" or (paid and row["customization"]),
        priority_support=plan == "enterprise"
        or (row["priority_support_until"] is not None and row["priority_support_until"] >= today),
        active_outlets=(active := active_outlets(conn, ws, today)),
        bill_sen=monthly_bill_sen(active) if plan == "pro" else None,
        ai_used=_ai_used(conn, ws),
        ai_allowed=_ai_allowed(plan, row["plan_billing"] if paid else None, outlets_allowed),
    )


def require(conn: psycopg.Connection, ws: int, feature: str) -> None:
    """Refuse adding something the plan does not include. What exists keeps working."""
    plan = current(conn, ws)
    if feature == "outlet":
        if plan.outlets_allowed is not None and plan.outlets_used >= plan.outlets_allowed:
            raise ForbiddenError(
                f"your plan includes {plan.outlets_allowed} outlet{'s' if plan.outlets_allowed > 1 else ''}: "
                "see Settings, Plan & billing to add more"
            )
    elif feature == "product":
        if plan.plan == "free":
            used = conn.execute(
                "SELECT count(*) AS n FROM products WHERE workspace_id = %s AND NOT archived", (ws,)
            ).fetchone()["n"]
            if used >= FREE_PRODUCTS:
                raise ForbiddenError(
                    f"the Free plan holds up to {FREE_PRODUCTS} products: archive one you no longer buy, "
                    "or see Settings, Plan & billing to upgrade"
                )
    elif not getattr(plan, feature):
        raise ForbiddenError(UPGRADE)


def code_digest(code: str) -> str:
    """Spaces, dashes and case do not matter when a code is typed."""
    return token_digest("".join(c for c in code.upper() if c.isalnum()))


def redeem(conn: psycopg.Connection, owner: CurrentUser, code: str) -> PlanOut:
    """Turn Pro on with a code from the team. Each workspace can use a code once; a yearly code adds its days
    to Pro time still left. It never takes away outlets or customization already paid for."""
    ws = owner.workspace_id
    digest = code_digest(code)
    row = conn.execute(
        "SELECT * FROM plan_codes WHERE token_hash = %s AND uses_left > 0 AND (expires_on IS NULL OR expires_on >= CURRENT_DATE) "
        "AND NOT EXISTS (SELECT 1 FROM plan_code_uses u WHERE u.token_hash = plan_codes.token_hash AND u.workspace_id = %s) "
        "FOR UPDATE",
        (digest, ws),
    ).fetchone()
    # One message for wrong, used up, expired and already used here, so a guess learns nothing.
    if row is None:
        raise InvalidRequestError("this code is not valid: it may be mistyped, used up or expired")
    now = current(conn, ws)
    if now.plan == "enterprise" or (now.plan == "pro" and now.billing == "lifetime" and row["days"] is not None):
        raise ConflictError(f"this workspace is already on {now.label}{' for life' if now.billing == 'lifetime' else ''}")
    paid = conn.execute("SELECT paid_outlets, customization FROM workspaces WHERE id = %s", (ws,)).fetchone()
    keep = now.plan == "pro"  # what an active Pro plan already has stays
    if row["days"] is None:
        billing, until = "lifetime", None
    else:
        start = now.until if keep and now.until and now.until >= date.today() else date.today()
        billing, until = "annual", start + timedelta(days=row["days"])
    outlets = max(row["paid_outlets"], paid["paid_outlets"] if keep else 0)
    customization = row["customization"] or (keep and paid["customization"])
    conn.execute(
        "UPDATE workspaces SET plan = 'pro', plan_billing = %s, plan_until = %s, paid_outlets = %s, customization = %s WHERE id = %s",
        (billing, until, outlets, customization, ws),
    )
    conn.execute("UPDATE plan_codes SET uses_left = uses_left - 1 WHERE token_hash = %s", (digest,))
    conn.execute("INSERT INTO plan_code_uses (token_hash, workspace_id) VALUES (%s, %s)", (digest, ws))
    total = 1 + outlets
    detail = (
        f"Pro {'for life' if until is None else f'until {until:%d %b %Y}'}, {total} outlet{'s' if total != 1 else ''}"
        + (", customization" if customization else "")
    )
    audit(conn, ws, owner.display_name, "plan.code_redeemed", None, detail)
    return current(conn, ws)
