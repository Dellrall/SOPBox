"""The app for the Playwright tests: a throwaway embedded PostgreSQL plus the API serving the built
frontend on http://127.0.0.1:4173. Run by playwright.config.ts; needs requirements-dev.txt.

As in production, the app connects as an ordinary role that owns its tables; Row Level Security
is forced on them, so it still applies.
"""

import os
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))

import psycopg  # noqa: E402
import pixeltable_pgserver as pgserver  # noqa: E402
import uvicorn  # noqa: E402

PORT = int(os.environ.get("E2E_PORT", "4173"))

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="sopbox-e2e-") as data:
        server = pgserver.get_server(data)
        admin_url = server.get_uri()
        with psycopg.connect(admin_url, autocommit=True) as conn:
            conn.execute("CREATE ROLE sopbox_app LOGIN NOSUPERUSER NOBYPASSRLS")
            conn.execute("ALTER SCHEMA public OWNER TO sopbox_app")
        os.environ["DATABASE_URL"] = admin_url.replace("postgres:@", "sopbox_app:@", 1)
        os.environ["COOKIE_SECURE"] = "0"  # plain http on localhost
        os.environ["MFA_ENCRYPTION_KEY"] = "vKpwP0lnmhRaAZG3iYxkAU-jyjk2eJ5GWVuEB7iwyiQ"  # a test key, never used for real
        for name in ("RUNPOD_ENDPOINT_ID", "RUNPOD_API_KEY", "TELEGRAM_BOT_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"):
            os.environ.pop(name, None)
        try:
            uvicorn.run("app.main:app", host="127.0.0.1", port=PORT, log_level="warning")
        finally:
            server.cleanup()
