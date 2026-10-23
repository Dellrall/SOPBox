"""Bring the database in DATABASE_URL up to the app's current schema, then exit.

The app does the same on every start. Run this on Replit before Publish (or press Run once):
Publish compares the development database with production and plans to make production match,
so a development database that is behind would make it propose dropping new production tables
and columns, and their data.

    cd src/backend && python -m app.migrate
"""

from app.db import close_pool, init_db


def main() -> None:
    init_db()
    close_pool()
    print("Database schema is up to date.")


if __name__ == "__main__":
    main()
