"""Last way back in: turn off two-step sign-in for one account, for an owner who lost their phone,
their backup codes and has no passkey (anyone else asks their owner, in Team).

Run by whoever runs the server, after checking who is asking (for example on a call with the
owner, matching the workspace name and email): from src/backend,
    python -m app.reset_mfa <username>
"""

import sys
from contextlib import contextmanager

from app import mfa
from app.auditlog import audit
from app.db import get_db, scope_to_workspace


def main(username: str) -> int:
    with contextmanager(get_db)() as conn:
        row = conn.execute(
            "SELECT id, workspace_id, totp_secret IS NOT NULL AS on FROM users WHERE lower(username) = lower(%s)",
            (username,),
        ).fetchone()
        if row is None:
            print(f"no account named {username}")
            return 1
        if not row["on"]:
            print(f"{username} does not have two-step sign-in on")
            return 0
        scope_to_workspace(conn, row["workspace_id"])  # the activity log is per workspace
        with conn.transaction():
            mfa.reset(conn, row["id"])
            audit(conn, row["workspace_id"], "system", "mfa.reset", None, f"two-step sign-in reset for {username} by the server")
    print(f"two-step sign-in is off for {username}; they sign in with their password and can set it up again")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.reset_mfa <username>")
    sys.exit(main(sys.argv[1]))
