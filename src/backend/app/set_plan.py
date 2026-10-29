"""Turn a paid plan on or off for a workspace, after payment, until the internal operations site
does this. From src/backend:
    python -m app.set_plan <workspace id> pro --billing annual --until 2027-10-31 --outlets 2
    python -m app.set_plan <workspace id> pro --billing lifetime --outlets 3 --customization
    python -m app.set_plan <workspace id> free
    python -m app.set_plan <workspace id> --priority-support-until 2027-10-31
--outlets is how many outlets are paid for beyond the free one.
"""

import argparse
import sys
from contextlib import contextmanager

from app.auditlog import audit
from app.db import get_db, scope_to_workspace


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.set_plan")
    parser.add_argument("workspace_id", type=int)
    parser.add_argument("plan", nargs="?", choices=["free", "pro", "enterprise"])
    parser.add_argument("--billing", choices=["annual", "lifetime"])
    parser.add_argument("--until", help="annual: last paid day, YYYY-MM-DD")
    parser.add_argument("--outlets", type=int, help="paid outlets beyond the free one")
    parser.add_argument("--customization", action=argparse.BooleanOptionalAction)
    parser.add_argument("--priority-support-until", help="YYYY-MM-DD, or 'none'")
    args = parser.parse_args(argv)
    if args.plan == "pro" and args.billing == "annual" and not args.until:
        parser.error("an annual plan needs --until")

    changes: dict = {}
    if args.plan:
        changes["plan"] = args.plan
        changes["plan_billing"] = None if args.plan == "free" else args.billing
        changes["plan_until"] = args.until if args.billing == "annual" else None
    if args.outlets is not None:
        changes["paid_outlets"] = args.outlets
    if args.customization is not None:
        changes["customization"] = args.customization
    if args.priority_support_until:
        changes["priority_support_until"] = None if args.priority_support_until == "none" else args.priority_support_until
    if not changes:
        parser.error("nothing to change")

    with contextmanager(get_db)() as conn:
        assignments = ", ".join(f"{k} = %s" for k in changes)
        row = conn.execute(
            f"UPDATE workspaces SET {assignments} WHERE id = %s RETURNING name", (*changes.values(), args.workspace_id)
        ).fetchone()
        if row is None:
            print(f"no workspace {args.workspace_id}")
            return 1
        scope_to_workspace(conn, args.workspace_id)  # the activity log is per workspace
        detail = ", ".join(f"{k} = {v}" for k, v in changes.items())
        audit(conn, args.workspace_id, "system", "plan.changed", None, detail)
    print(f"{row['name']}: {detail}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
