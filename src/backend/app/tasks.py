"""Task lists: daily ones (opening, closing) and ones for an event (peak hour, a new starter).

Each list is for everyone, staff or managers. Managers see every list; staff see theirs. A step is
ticked for a day; the day comes from the phone, so a list starts fresh at the outlet's midnight.
"""

from datetime import date, datetime, timedelta, timezone

import psycopg
from psycopg.types.json import Jsonb

from app.auditlog import audit
from app.auth import CurrentUser
from app.errors import InvalidRequestError, NotFoundError
from app.models import TaskList, TaskListIn, TaskTick, TickIn


def _roles_seen(user: CurrentUser) -> tuple[str, ...]:
    return ("everyone", "staff") if user.role == "staff" else ("everyone", "staff", "manager")


def _check_day(day: date) -> None:
    # Phones are a few hours either side of UTC; a day further off is a wrong clock or a replay.
    today = datetime.now(timezone.utc).date()
    if abs(day - today) > timedelta(days=1):
        raise InvalidRequestError("tasks can only be ticked for today")


def list_tasks(conn: psycopg.Connection, user: CurrentUser, day: date, only: int | None = None) -> list[TaskList]:
    rows = conn.execute(
        "SELECT * FROM task_lists WHERE workspace_id = %s AND for_role = ANY(%s) AND (%s::bigint IS NULL OR id = %s) "
        "ORDER BY kind, lower(name)",
        (user.workspace_id, list(_roles_seen(user)), only, only),
    ).fetchall()
    ticks: dict[int, list[TaskTick]] = {r["id"]: [] for r in rows}
    if rows:
        for t in conn.execute(
            "SELECT task_list_id, step, done_by, done_at FROM task_ticks WHERE task_list_id = ANY(%s) AND day = %s "
            "ORDER BY step",
            (list(ticks), day),
        ):
            ticks[t["task_list_id"]].append(
                TaskTick(step=t["step"], done_by=t["done_by"], done_at=t["done_at"].isoformat(timespec="seconds"))
            )
    return [
        TaskList(id=r["id"], name=r["name"], kind=r["kind"], for_role=r["for_role"], steps=r["steps"], ticks=ticks[r["id"]])
        for r in rows
    ]


def _one(conn: psycopg.Connection, user: CurrentUser, list_id: int, day: date) -> TaskList:
    found = list_tasks(conn, user, day, only=list_id)
    if not found:
        raise NotFoundError(f"task list {list_id} not found")
    return found[0]


def create_list(conn: psycopg.Connection, user: CurrentUser, data: TaskListIn) -> TaskList:
    with conn.transaction():
        row = conn.execute(
            "INSERT INTO task_lists (workspace_id, name, kind, for_role, steps) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (user.workspace_id, data.name, data.kind, data.for_role, Jsonb(data.steps)),
        ).fetchone()
        audit(conn, user.workspace_id, user.display_name, "task_list.created", None, data.name)
    return _one(conn, user, row["id"], datetime.now(timezone.utc).date())


def update_list(conn: psycopg.Connection, user: CurrentUser, list_id: int, data: TaskListIn) -> TaskList:
    with conn.transaction():
        cur = conn.execute(
            "UPDATE task_lists SET name = %s, kind = %s, for_role = %s, steps = %s WHERE id = %s AND workspace_id = %s",
            (data.name, data.kind, data.for_role, Jsonb(data.steps), list_id, user.workspace_id),
        )
        if cur.rowcount == 0:
            raise NotFoundError(f"task list {list_id} not found")
        # Steps may have moved, so today's ticks no longer point at the right ones.
        conn.execute("DELETE FROM task_ticks WHERE task_list_id = %s AND step >= %s", (list_id, len(data.steps)))
        audit(conn, user.workspace_id, user.display_name, "task_list.updated", None, data.name)
    return _one(conn, user, list_id, datetime.now(timezone.utc).date())


def delete_list(conn: psycopg.Connection, user: CurrentUser, list_id: int) -> None:
    with conn.transaction():
        row = conn.execute(
            "DELETE FROM task_lists WHERE id = %s AND workspace_id = %s RETURNING name", (list_id, user.workspace_id)
        ).fetchone()
        if row is None:
            raise NotFoundError(f"task list {list_id} not found")
        audit(conn, user.workspace_id, user.display_name, "task_list.deleted", None, row["name"])


def tick(conn: psycopg.Connection, user: CurrentUser, list_id: int, data: TickIn) -> TaskList:
    _check_day(data.day)
    current = _one(conn, user, list_id, data.day)  # also refuses a list this person cannot see
    if data.step >= len(current.steps):
        raise InvalidRequestError("no such step")
    if data.done:
        conn.execute(
            "INSERT INTO task_ticks (task_list_id, day, step, done_by) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
            (list_id, data.day, data.step, user.display_name),
        )
    else:
        conn.execute(
            "DELETE FROM task_ticks WHERE task_list_id = %s AND day = %s AND step = %s", (list_id, data.day, data.step)
        )
    return _one(conn, user, list_id, data.day)
