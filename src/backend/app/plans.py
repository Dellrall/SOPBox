"""Plans: Free for one store, Pro for more, Enterprise by talking to sales.

Every price, link and contact detail SOPBox shows lives at the top of this file; None prints as
"TBC". Payments are not taken in the app yet: an owner sends an upgrade request, and the team turns
the plan on (`python -m app.set_plan`, later the internal operations site).

- Free: one outlet (any number of storage areas in it), the whole team, AI reading, stock, sales.
- Pro: extra outlets (priced per outlet, a year or for life), HQ branch links, till API keys.
  Add-ons: customization (branding, own fields and checks, own SOP templates and reports) and
  priority support, each paid on its own.
- Enterprise: a price agreed with sales; everything on.
Workspaces from before plans are pre-alpha users: what they already set up keeps working, and
adding more follows their plan. An annual plan that has run out counts as Free (nothing is deleted).
"""

from datetime import date

import psycopg

from app.errors import ForbiddenError
from app.models import PlanOut, PricingOut

CURRENCY = "RM"
PRICES: dict[str, int | None] = {
    "pro_outlet_year": None,  # each outlet after the first, per year
    "pro_outlet_lifetime": None,  # each outlet after the first, once
    "customization_year": None,
    "customization_lifetime": None,
    "priority_support_year": None,
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
