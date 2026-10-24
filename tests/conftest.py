import os

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import auth, extraction
from app.db import close_pool, init_db
from app.main import app

PASSWORD = "correct horse battery"
_TABLES = "workspaces, users, sessions, categories, products, pack_units, deliveries, delivery_lines, audit_log, stocktake_lines, stocktakes, suppliers, purchase_orders, purchase_order_lines"


@pytest.fixture(scope="session", autouse=True)
def _database(tmp_path_factory):
    """One embedded PostgreSQL server for the whole run (no Postgres install needed).

    The tables are created by the server's superuser, but the app itself connects as an ordinary
    role. A superuser skips Row Level Security, so only an ordinary role proves the policies hold
    for every route in the suite.
    """
    import pixeltable_pgserver as pgserver

    server = pgserver.get_server(tmp_path_factory.mktemp("pg"))
    admin_url = server.get_uri()
    previous = os.environ.get("DATABASE_URL")

    os.environ["DATABASE_URL"] = admin_url
    init_db()
    close_pool()
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute("CREATE ROLE sopbox_app LOGIN NOSUPERUSER NOBYPASSRLS")
        conn.execute("GRANT ALL ON ALL TABLES IN SCHEMA public TO sopbox_app")
        conn.execute("GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO sopbox_app")
    os.environ["DATABASE_URL"] = admin_url.replace("postgres:@", "sopbox_app:@", 1)

    yield admin_url

    close_pool()
    if previous is None:
        os.environ.pop("DATABASE_URL")
    else:
        os.environ["DATABASE_URL"] = previous
    server.cleanup()


@pytest.fixture(autouse=True)
def _isolated_env(_database, monkeypatch):
    """Every test starts from empty tables and no real Telegram or RunPod settings."""
    monkeypatch.setenv("COOKIE_SECURE", "0")  # TestClient speaks plain http
    for name in ("RUNPOD_ENDPOINT_ID", "RUNPOD_API_KEY", "TELEGRAM_BOT_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    extraction._calls.clear()
    auth._fails.clear()
    auth._register_hits.clear()
    # The owner of the embedded server bypasses row-level security, so this sees every row.
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute(f"TRUNCATE {_TABLES} RESTART IDENTITY CASCADE")


def sign_up(workspace="Test Kitchen", username="olive", name="Olive Owner", password=PASSWORD):
    """A new TestClient that has created a workspace and is signed in as its owner."""
    c = TestClient(app)
    resp = c.post(
        "/api/auth/register",
        json={
            "workspace_name": workspace,
            "display_name": name,
            "email": f"{username}@example.com",
            "username": username,
            "password": password,
        },
    )
    assert resp.status_code == 201, resp.text
    return c


def sign_in(username, password=PASSWORD):
    c = TestClient(app)
    resp = c.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return c


@pytest.fixture
def anon():
    """Not signed in."""
    return TestClient(app)


@pytest.fixture
def client():
    """Signed in as the owner of the workspace 'Test Kitchen' (display name 'Olive Owner')."""
    return sign_up()


@pytest.fixture
def make_user(client):
    """Create an account in the client's workspace and return a client signed in as it."""

    def make(role="staff", username=None, name=None):
        username = username or f"{role}1"
        resp = client.post(
            "/api/users",
            json={
                "username": username,
                "display_name": name or username.title(),
                "role": role,
                "password": PASSWORD,
            },
        )
        assert resp.status_code == 201, resp.text
        return sign_in(username)

    return make


@pytest.fixture
def catalogue_ids(client):
    """A small catalogue built through the API: one frozen product, one bundled product."""

    def post(path, body):
        resp = client.post(path, json=body)
        assert resp.status_code == 201, resp.text
        return resp.json()

    frozen = post("/api/categories", {"name": "Frozen", "temp_min_c": -20, "temp_max_c": -10})
    packaging = post("/api/categories", {"name": "Packaging"})
    sausage = post(
        "/api/products",
        {"name": "Frozen sausage", "category_id": frozen["id"], "base_unit": "pcs", "min_stock": 50},
    )
    fries = post(
        "/api/products",
        {
            "name": "Fries tray",
            "category_id": packaging["id"],
            "base_unit": "pcs",
            "pack_units": [{"unit": "bdl", "base_qty": 250}],
        },
    )
    return {
        "frozen_category": frozen["id"],
        "packaging_category": packaging["id"],
        "sausage": sausage["id"],
        "fries": fries["id"],
    }
