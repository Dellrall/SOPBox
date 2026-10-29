"""Sales enquiries from the public pricing page, upgrade requests and support requests. Stored for
the team; the internal operations site will list and answer them."""

import psycopg

from app.auditlog import audit
from app.auth import CurrentUser
from app.models import InquiryOut, SalesInquiryIn, SupportIn, UpgradeRequestIn
from app import plans


def _save(conn: psycopg.Connection, **fields) -> InquiryOut:
    columns = ", ".join(fields)
    row = conn.execute(
        f"INSERT INTO inquiries ({columns}) VALUES ({', '.join(['%s'] * len(fields))}) RETURNING id, priority",
        tuple(fields.values()),
    ).fetchone()
    return InquiryOut(**row)


def sales(conn: psycopg.Connection, data: SalesInquiryIn) -> InquiryOut:
    return _save(conn, kind="sales", **data.model_dump())


def upgrade(conn: psycopg.Connection, owner: CurrentUser, data: UpgradeRequestIn) -> InquiryOut:
    wanted = [f"Pro, {data.billing}", f"{data.outlets} outlet(s)"]
    wanted += ["customization"] * data.customization + ["priority support"] * data.priority_support
    message = "; ".join(wanted) + (f"\n{data.message}" if data.message else "")
    saved = _save(
        conn, kind="upgrade", workspace_id=owner.workspace_id, name=owner.display_name, email=owner.email or "",
        phone=data.phone, outlets=data.outlets, message=message,
    )
    audit(conn, owner.workspace_id, owner.display_name, "plan.upgrade_requested", None, "; ".join(wanted))
    return saved


def support(conn: psycopg.Connection, user: CurrentUser, data: SupportIn) -> InquiryOut:
    """Everyone can ask; workspaces that pay for priority support are answered first."""
    priority = plans.current(conn, user.workspace_id).priority_support
    return _save(
        conn, kind="support", workspace_id=user.workspace_id, name=user.display_name, email=user.email or "",
        company=user.workspace_name, message=data.message, priority=priority,
    )
