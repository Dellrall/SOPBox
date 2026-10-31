"""Who is in charge (PIC) of open work, and the jobs that work makes for them each day.

Jobs are worked out from the records every time: an issued purchase order still to arrive, a held
delivery waiting for a decision, a stock count planned for a day. Only the PICs are stored.

Who may become PIC:
- a manager (or the owner) assigns anyone, or removes anyone, without asking;
- anyone adds themselves to a job with no PIC, or joins a big order that has one PIC;
- otherwise they ask to take it over, and a manager approves (replacing the PICs) or declines.
Every call is idempotent: assigning a PIC twice, asking twice or deciding twice changes nothing
the second time. Every change is in the activity log.
"""

from datetime import date

import psycopg

from app import inbox, insights, locations, notifications, purchasing
from app.auditlog import audit
from app.auth import CurrentUser, can_access_section
from app.errors import ForbiddenError, InvalidRequestError, NotFoundError
from app.models import AssignIn, AssignmentRequest, AssignOut, CountPlanIn, Job, JobTick, JobTickIn, Pic

MAX_PICS = 2  # a big order may have this many; any other job one
PAGE = {"po": "purchasing", "delivery": "approvals", "count": "stocktake"}


def _manager(user: CurrentUser) -> bool:
    return user.role != "staff"


def _due_text(kind: str, days: int | None) -> str:
    if days is None:
        return "No delivery date yet: ask the supplier when it comes" if kind == "po" else "Waiting for a decision: follow it up"
    if days > 1:
        return f"Due in {days} days"
    late = f"{-days} day{'s' if days < -1 else ''} late"
    if kind == "po":
        return {1: "Due tomorrow: check it is on the way", 0: "Due today: get ready to check temperatures and packs"}.get(
            days, f"{late}: call the supplier"
        )
    return {1: "Due tomorrow", 0: "Count it today"}.get(days, f"{late}: count it now")


def _thresholds(conn: psycopg.Connection, ws: int) -> tuple[int, int]:
    row = conn.execute("SELECT big_order_sen, big_order_lines FROM workspaces WHERE id = %s", (ws,)).fetchone()
    return row["big_order_sen"], row["big_order_lines"]


def _temp(lo: float | None, hi: float | None) -> str:
    n = lambda v: f"{v:g}"  # noqa: E731
    if lo is not None and hi is not None:
        return f"{n(lo)} to {n(hi)}°C"
    return f"at most {n(hi)}°C" if hi is not None else f"at least {n(lo)}°C"


def _order_steps(supplier: str, product_ids: list[int], products: dict[int, dict]) -> list[str]:
    """The receiving SOP for one order, from its products' categories and SOP cards."""
    steps = [f"Call {supplier} to check it is on the way", "Clear space in the chiller, freezer and store"]
    temps: dict[str, str] = {}
    sop: list[str] = []
    for pid in product_ids:
        p = products.get(pid)
        if p is None:
            continue
        if p["temp_min_c"] is not None or p["temp_max_c"] is not None:
            temps.setdefault(p["category"], _temp(p["temp_min_c"], p["temp_max_c"]))
        if p["sop"] and p["name"] not in sop:
            sop.append(p["name"])
    if temps:
        steps.append("Have a clean probe thermometer ready")
        steps += [f"{cat}: check {t}" for cat, t in sorted(temps.items())]
    if sop:
        steps.append(f"Read the SOP card for {', '.join(sop[:3])}{' and more' if len(sop) > 3 else ''}")
    steps += ["Check packs and expiry dates against the order", "Receive it in SOPBox with a photo of the delivery order"]
    return steps


# The section someone needs edit access to, to do each kind of job.
SECTION = {"po": "receive", "delivery": "approvals", "count": "stocktake"}


def _open_work(conn: psycopg.Connection, ws: int) -> dict[tuple[str, int], dict]:
    """Every open job: its title, due date, whether it is big, and its steps."""
    big_sen, big_lines = _thresholds(conn, ws)
    prices = insights.latest_prices(conn, ws)
    products = {
        r["id"]: r
        for r in conn.execute(
            "SELECT p.id, p.name, p.sop <> '' AS sop, c.name AS category, c.temp_min_c, c.temp_max_c "
            "FROM products p JOIN categories c ON c.id = p.category_id WHERE p.workspace_id = %s",
            (ws,),
        ).fetchall()
    }
    work: dict[tuple[str, int], dict] = {}
    for o in purchasing.list_orders(conn, ws):
        if o.status != "issued" or o.receiving_status == "fully_received":
            continue
        value = sum(line.ordered_base_qty * prices.get(line.product_id, 0) for line in o.lines)
        work[("po", o.id)] = {
            "title": f"{o.reference} from {o.supplier}",
            "due": date.fromisoformat(o.expected_date) if o.expected_date else None,
            "big": value >= big_sen or len(o.lines) >= big_lines,
            "steps": _order_steps(o.supplier, [line.product_id for line in o.lines], products),
        }
    for d in conn.execute(
        "SELECT d.id, d.supplier, COUNT(l.id) AS lines, COALESCE(SUM(l.unit_price_sen * l.quantity), 0) AS value "
        "FROM deliveries d LEFT JOIN delivery_lines l ON l.delivery_id = d.id "
        "WHERE d.workspace_id = %s AND d.status = 'pending_approval' "
        f"AND {locations.mine('d.storage_id')} GROUP BY d.id ORDER BY d.id",
        (ws,),
    ).fetchall():
        work[("delivery", d["id"])] = {
            "title": f"Held delivery #{d['id']} from {d['supplier'] or 'an unknown supplier'}",
            "due": None,
            "big": d["value"] >= big_sen or d["lines"] >= big_lines,
            "steps": ["Read why each line was held", "Look at the photos and readings",
                      "Approve or reject it, with a reason", "Tell the supplier about anything sent back"],
        }
    for c in conn.execute(
        f"SELECT c.id, c.due_date, {locations.LABEL_SQL} AS label FROM count_plans c "
        "JOIN storages s ON s.id = c.storage_id JOIN outlets o ON o.id = s.outlet_id "
        f"WHERE c.workspace_id = %s AND c.stocktake_id IS NULL AND {locations.mine('c.storage_id')} ORDER BY c.due_date",
        (ws,),
    ).fetchall():
        work[("count", c["id"])] = {
            "title": f"Count {c['label']}", "due": c["due_date"], "big": False,
            "steps": [f"Go to {c['label']} before the shift gets busy", "Count every shelf, front to back",
                      "Check expiry dates as you count", "Save the count in Stock count"],
        }
    return work


def _pics(conn: psycopg.Connection, ws: int) -> dict[tuple[str, int], list[Pic]]:
    out: dict[tuple[str, int], list[Pic]] = {}
    for r in conn.execute(
        "SELECT a.kind, a.ref_id, a.user_id, u.display_name FROM assignments a JOIN users u ON u.id = a.user_id "
        "WHERE a.workspace_id = %s ORDER BY a.at",
        (ws,),
    ).fetchall():
        out.setdefault((r["kind"], r["ref_id"]), []).append(Pic(user_id=r["user_id"], name=r["display_name"]))
    return out


def _can_join(pics: list[Pic], big: bool) -> bool:
    return not pics or (big and len(pics) < MAX_PICS)


def jobs(conn: psycopg.Connection, user: CurrentUser, day: date) -> list[Job]:
    """Every open job, the person's own first, then the soonest due."""
    ws = user.workspace_id
    pics = _pics(conn, ws)
    asked = {
        (r["kind"], r["ref_id"])
        for r in conn.execute(
            "SELECT kind, ref_id FROM assignment_requests WHERE workspace_id = %s AND user_id = %s AND status = 'pending'",
            (ws, user.id),
        )
    }
    ticks: dict[tuple[str, int], list[JobTick]] = {}
    for r in conn.execute("SELECT kind, ref_id, step, done_by FROM job_ticks WHERE workspace_id = %s ORDER BY done_at", (ws,)):
        ticks.setdefault((r["kind"], r["ref_id"]), []).append(JobTick(step=r["step"], done_by=r["done_by"]))
    out = []
    for (kind, ref), w in _open_work(conn, ws).items():
        if not can_access_section(user, SECTION[kind], edit=True):
            continue  # not their work: staff without approvals access never see held deliveries
        mine = pics.get((kind, ref), [])
        days = (w["due"] - day).days if w["due"] else None
        out.append(Job(
            kind=kind, ref_id=ref, title=w["title"], when=_due_text(kind, days),
            due=w["due"].isoformat() if w["due"] else None, days_left=days, big=w["big"], pics=mine,
            can_take=all(p.user_id != user.id for p in mine) and (_manager(user) or _can_join(mine, w["big"])),
            asked=(kind, ref) in asked, page=PAGE[kind], steps=w["steps"],
            ticks=[t for t in ticks.get((kind, ref), []) if t.step in w["steps"]],
        ))
    is_mine = lambda j: any(p.user_id == user.id for p in j.pics)  # noqa: E731
    return sorted(out, key=lambda j: (not is_mine(j), j.days_left if j.days_left is not None else 9999, j.title))


def _job(conn: psycopg.Connection, ws: int, kind: str, ref_id: int) -> dict:
    found = _open_work(conn, ws).get((kind, ref_id))
    if found is None:
        raise NotFoundError("that job is done or does not exist")
    return found


def _member(conn: psycopg.Connection, ws: int, user_id: int, kind: str) -> str:
    """Their name, once they are known to be able to do this kind of job."""
    row = conn.execute(
        "SELECT display_name, role, section_access FROM users WHERE id = %s AND workspace_id = %s AND active", (user_id, ws)
    ).fetchone()
    if row is None:
        raise InvalidRequestError("that person is not an active member of this workspace")
    if row["role"] == "staff" and (row["section_access"] or {}).get(SECTION[kind]) != "edit":
        raise ForbiddenError(f"{row['display_name']} cannot do this kind of job; give them access in Team first")
    return row["display_name"]


def assign(conn: psycopg.Connection, user: CurrentUser, data: AssignIn) -> AssignOut:
    ws, target = user.workspace_id, data.user_id or user.id
    if target != user.id and not _manager(user):
        raise ForbiddenError("only a manager can make someone else the PIC")
    with conn.transaction():
        # One change at a time per workspace, so two people cannot both become the only PIC.
        conn.execute("SELECT id FROM workspaces WHERE id = %s FOR UPDATE", (ws,))
        job = _job(conn, ws, data.kind, data.ref_id)
        name = _member(conn, ws, target, data.kind)
        current = _pics(conn, ws).get((data.kind, data.ref_id), [])
        if any(p.user_id == target for p in current):
            return AssignOut(status="already")
        if _manager(user) or _can_join(current, job["big"]):
            conn.execute(
                "INSERT INTO assignments (workspace_id, kind, ref_id, user_id, assigned_by) VALUES (%s, %s, %s, %s, %s)",
                (ws, data.kind, data.ref_id, target, user.display_name),
            )
            how = "took it on" if target == user.id else f"assigned by {user.display_name}"
            audit(conn, ws, user.display_name, "assignment.added", None, f"{job['title']}: {name} ({how})")
            if target != user.id:
                notifications.tell(conn, [target], f"SOPBox: {user.display_name} made you PIC of {job['title']}.")
            return AssignOut(status="assigned")
        made = conn.execute(
            "INSERT INTO assignment_requests (workspace_id, kind, ref_id, user_id) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (kind, ref_id, user_id) WHERE status = 'pending' DO NOTHING RETURNING id",
            (ws, data.kind, data.ref_id, target),
        ).fetchone()
        if made:
            audit(conn, ws, user.display_name, "assignment.requested", None,
                  f"{job['title']}: asks to take over from {', '.join(p.name for p in current)}")
            notifications.tell(conn, inbox.approver_ids(conn, ws),
                               f"SOPBox: {name} asks to take over {job['title']}. Approve or decline it in Tasks.")
    return AssignOut(status="requested")


def unassign(conn: psycopg.Connection, user: CurrentUser, kind: str, ref_id: int, user_id: int) -> None:
    if user_id != user.id and not _manager(user):
        raise ForbiddenError("only a manager can remove someone else as PIC")
    with conn.transaction():
        row = conn.execute(
            "DELETE FROM assignments a USING users u WHERE u.id = a.user_id AND a.workspace_id = %s "
            "AND a.kind = %s AND a.ref_id = %s AND a.user_id = %s RETURNING u.display_name",
            (user.workspace_id, kind, ref_id, user_id),
        ).fetchone()
        if row:  # already gone: nothing to do or log
            title = _open_work(conn, user.workspace_id).get((kind, ref_id), {}).get("title", f"{kind} {ref_id}")
            audit(conn, user.workspace_id, user.display_name, "assignment.removed", None, f"{title}: {row['display_name']}")


def requests(conn: psycopg.Connection, ws: int) -> list[AssignmentRequest]:
    work, pics = _open_work(conn, ws), _pics(conn, ws)
    out = []
    for r in conn.execute(
        "SELECT r.*, u.display_name FROM assignment_requests r JOIN users u ON u.id = r.user_id "
        "WHERE r.workspace_id = %s AND r.status = 'pending' ORDER BY r.created_at",
        (ws,),
    ).fetchall():
        job = work.get((r["kind"], r["ref_id"]))
        if job is None:
            continue  # the job is done; nothing left to take over
        out.append(AssignmentRequest(
            id=r["id"], kind=r["kind"], ref_id=r["ref_id"], title=job["title"], user_id=r["user_id"],
            name=r["display_name"], replaces=[p.name for p in pics.get((r["kind"], r["ref_id"]), [])],
            created_at=r["created_at"].isoformat(timespec="seconds"),
        ))
    return out


def decide(conn: psycopg.Connection, manager: CurrentUser, request_id: int, approve: bool) -> None:
    ws = manager.workspace_id
    with conn.transaction():
        r = conn.execute(
            "SELECT r.*, u.display_name FROM assignment_requests r JOIN users u ON u.id = r.user_id "
            "WHERE r.id = %s AND r.workspace_id = %s FOR UPDATE",
            (request_id, ws),
        ).fetchone()
        if r is None:
            raise NotFoundError(f"request {request_id} not found")
        if r["status"] != "pending":
            return  # decided already
        job = _job(conn, ws, r["kind"], r["ref_id"]) if approve else None
        conn.execute(
            "UPDATE assignment_requests SET status = %s, decided_by = %s, decided_at = now() WHERE id = %s",
            ("approved" if approve else "declined", manager.display_name, request_id),
        )
        if not approve:
            audit(conn, ws, manager.display_name, "assignment.declined", None, f"{r['display_name']} stays off it")
            notifications.tell(conn, [r["user_id"]], f"SOPBox: {manager.display_name} declined your request to take over that job.")
            return
        before = [p.name for p in _pics(conn, ws).get((r["kind"], r["ref_id"]), [])]
        conn.execute("DELETE FROM assignments WHERE workspace_id = %s AND kind = %s AND ref_id = %s", (ws, r["kind"], r["ref_id"]))
        conn.execute(
            "INSERT INTO assignments (workspace_id, kind, ref_id, user_id, assigned_by) VALUES (%s, %s, %s, %s, %s)",
            (ws, r["kind"], r["ref_id"], r["user_id"], manager.display_name),
        )
        was = f", replacing {', '.join(before)}" if before else ""
        audit(conn, ws, manager.display_name, "assignment.approved", None, f"{job['title']}: {r['display_name']}{was}")
        notifications.tell(conn, [r["user_id"]], f"SOPBox: {manager.display_name} approved. You are now PIC of {job['title']}.")


def plan_count(conn: psycopg.Connection, manager: CurrentUser, data: CountPlanIn) -> None:
    ws = manager.workspace_id
    storage_id = locations.resolve(conn, ws, data.storage_id)
    with conn.transaction():
        plan = conn.execute(
            "INSERT INTO count_plans (workspace_id, storage_id, due_date, created_by) VALUES (%s, %s, %s, %s) RETURNING id",
            (ws, storage_id, data.due_date, manager.display_name),
        ).fetchone()["id"]
        audit(conn, ws, manager.display_name, "count.planned", None, f"for {data.due_date.isoformat()}")
    if data.user_id:
        assign(conn, manager, AssignIn(kind="count", ref_id=plan, user_id=data.user_id))


def unplan_count(conn: psycopg.Connection, manager: CurrentUser, plan_id: int) -> None:
    with conn.transaction():
        row = conn.execute(
            "DELETE FROM count_plans WHERE id = %s AND workspace_id = %s AND stocktake_id IS NULL RETURNING due_date",
            (plan_id, manager.workspace_id),
        ).fetchone()
        if row:
            conn.execute("DELETE FROM assignments WHERE kind = 'count' AND ref_id = %s", (plan_id,))
            conn.execute("DELETE FROM assignment_requests WHERE kind = 'count' AND ref_id = %s", (plan_id,))
            audit(conn, manager.workspace_id, manager.display_name, "count.unplanned", None, f"for {row['due_date'].isoformat()}")


def tick(conn: psycopg.Connection, user: CurrentUser, kind: str, ref_id: int, data: JobTickIn) -> None:
    """Mark one step of a job done or not done. Ticking twice changes nothing the second time."""
    ws = user.workspace_id
    if data.step not in _job(conn, ws, kind, ref_id)["steps"]:
        raise InvalidRequestError("that job has no such step")
    if data.done:
        conn.execute(
            "INSERT INTO job_ticks (workspace_id, kind, ref_id, step, done_by) VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
            (ws, kind, ref_id, data.step, user.display_name),
        )
    else:
        conn.execute(
            "DELETE FROM job_ticks WHERE workspace_id = %s AND kind = %s AND ref_id = %s AND step = %s", (ws, kind, ref_id, data.step)
        )
