"""Run a throwaway PostgreSQL for local development: `python -m app.devdb`.

Needs requirements-dev.txt. Prints the DATABASE_URL to export, then keeps the server up until
Ctrl+C. Data lives in src/backend/.pgdata (gitignored), so it survives restarts.
"""

import time
from pathlib import Path

import pixeltable_pgserver as pgserver

DATA = Path(__file__).resolve().parents[1] / ".pgdata"

if __name__ == "__main__":
    server = pgserver.get_server(DATA, cleanup_mode=None)
    print(f"export DATABASE_URL='{server.get_uri()}'\nexport COOKIE_SECURE=0")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
