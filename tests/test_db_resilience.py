"""The database can drop idle connections (Replit's PostgreSQL does after a few minutes)."""

import psycopg


def test_a_connection_the_database_dropped_is_replaced_not_used(client, _database):
    assert client.get("/api/auth/me").status_code == 200  # the pool now holds a used connection
    # Drop every connection the app has open, as the server does to idle ones.
    with psycopg.connect(_database, autocommit=True) as admin:
        killed = admin.execute(
            "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity "
            "WHERE usename = 'sopbox_app' AND pid <> pg_backend_pid()"
        ).fetchone()[0]
    assert killed >= 1
    # The next requests get a fresh connection instead of failing with a 500.
    assert client.get("/api/auth/me").status_code == 200
    assert client.get("/api/categories").status_code == 200


def test_an_unexpected_error_gives_a_plain_message(client, monkeypatch):
    from app import catalogue

    def broken(*args, **kwargs):
        raise RuntimeError("internal detail that must not reach the browser")

    monkeypatch.setattr(catalogue, "list_categories", broken)
    from fastapi.testclient import TestClient

    from app.main import app

    no_raise = TestClient(app, raise_server_exceptions=False, cookies=client.cookies)
    resp = no_raise.get("/api/categories")
    assert resp.status_code == 500
    assert resp.json() == {"detail": "Something went wrong on our side. Please try again."}
    assert "internal detail" not in resp.text


def test_the_migrate_command_brings_a_database_up_to_date(_database, capsys, monkeypatch):
    import psycopg

    from app import migrate

    # Run as the database owner, as on Replit. (The tests' app role may not change tables.)
    monkeypatch.setenv("DATABASE_URL", _database)
    with psycopg.connect(_database, autocommit=True) as admin:
        admin.execute("ALTER TABLE products DROP COLUMN archived")  # a database from before archiving
    migrate.main()
    assert "up to date" in capsys.readouterr().out
    with psycopg.connect(_database, autocommit=True) as admin:
        found = admin.execute(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'archived'"
        ).fetchone()
    assert found
