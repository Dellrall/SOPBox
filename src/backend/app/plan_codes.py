"""Make a code that turns Pro on, for an owner to enter in Settings, Plan & billing. Until payments
are taken in the app, this is how the team gives Pro (for testing, pilots or after payment). From src/backend:
    python -m app.plan_codes --outlets 4 --days 365 --uses 1
    python -m app.plan_codes --outlets 2 --days 30 --uses 20 --expires 2026-12-31 --note "pilot"
    python -m app.plan_codes --outlets 3 --lifetime --customization
--outlets is how many outlets beyond the free one; --uses is how many workspaces can enter it.
The code is printed once; only its SHA-256 is stored.
"""

import argparse
import secrets
import sys
from contextlib import contextmanager

from app.db import get_db
from app.plans import code_digest

# No 0/O or 1/I/L, so a code read out over the phone is typed right.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def new_code() -> str:
    """PRO-XXXX-XXXX-XXXX-XXXX: 16 characters from 31, about 79 random bits."""
    chars = "".join(secrets.choice(ALPHABET) for _ in range(16))
    return "PRO-" + "-".join(chars[i : i + 4] for i in range(0, 16, 4))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.plan_codes")
    parser.add_argument("--outlets", type=int, required=True, help="paid outlets beyond the free one")
    length = parser.add_mutually_exclusive_group(required=True)
    length.add_argument("--days", type=int, help="Pro for this many days")
    length.add_argument("--lifetime", action="store_true", help="Pro for life")
    parser.add_argument("--customization", action="store_true")
    parser.add_argument("--uses", type=int, default=1, help="how many workspaces can enter it (default 1)")
    parser.add_argument("--expires", help="last day it can be entered, YYYY-MM-DD")
    parser.add_argument("--note", default="", help="for the team, e.g. who it is for")
    args = parser.parse_args(argv)
    if args.outlets < 0 or args.uses < 1 or (args.days is not None and args.days < 1):
        parser.error("--outlets must be 0 or more, --uses and --days 1 or more")

    code = new_code()
    with contextmanager(get_db)() as conn:
        conn.execute(
            "INSERT INTO plan_codes (token_hash, paid_outlets, days, customization, uses_left, expires_on, note) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (code_digest(code), args.outlets, args.days, args.customization, args.uses, args.expires, args.note),
        )
    print(code)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
