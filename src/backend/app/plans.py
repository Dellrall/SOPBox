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

from datetime import date, timedelta

import psycopg

from app.auditlog import audit
from app.auth import CurrentUser, token_digest
from app.errors import ConflictError, ForbiddenError, InvalidRequestError
from app.models import PlanOut, PricingOut

CURRENCY = "RM"
# Launch prices hold for an early customer's first 12 months; "_later" is the list price after that.
PRICES: dict[str, int | None] = {
    "pro_month": 49,  # Pro with its first outlet, a month, paid yearly
    "pro_month_later": 89,
    "pro_outlet_month": 29,  # each outlet after the first, a month
    "pro_outlet_month_later": 49,
    "pro_outlet_year": 348,  # the same extra outlet, paid for the year
    "pro_outlet_lifetime": None,  # not offered: AI reading and hosting cost money every month
    "customization_year": None,  # custom work is quoted per task instead
    "customization_lifetime": None,
    "custom_task_from": 100,  # smallest custom job, quoted before work starts
    "priority_support_year": 190,  # free in an early customer's first year
    "enterprise_month_from": 399,
}
KOFI_URL = ""  # e.g. https://ko-fi.com/sopbox; the Donate button shows once set
SALES_EMAIL = ""
SALES_PHONE = ""

LABEL = {"free": "Free", "pro": "Pro", "enterprise": "Enterprise"}
UPGRADE = "your plan does not include this: see Settings, Plan & billing"


def pricing() -> PricingOut:
    return PricingOut(currency=CURRENCY, prices=PRICES, kofi_url=KOFI_URL, sales_email=SALES_EMAIL, sales_phone=SALES_PHONE)


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
    return PlanOut(
        plan=plan,
        label=LABEL[plan],
        pre_alpha=row["pre_alpha"],
        billing=row["plan_billing"] if paid else None,
        until=row["plan_until"] if paid else None,
        lapsed=lapsed and row["plan"] != "free",
        outlets_allowed=None if plan == "enterprise" else 1 + (row["paid_outlets"] if paid else 0),
        outlets_used=row["outlets_used"],
        api_access=paid,
        hq_links=paid,
        customization=plan == "enterprise" or (paid and row["customization"]),
        priority_support=plan == "enterprise"
        or (row["priority_support_until"] is not None and row["priority_support_until"] >= today),
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
