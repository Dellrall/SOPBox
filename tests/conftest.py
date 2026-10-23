import pytest
from fastapi.testclient import TestClient

from app import extraction
from app.db import init_db
from app.main import app

MANAGER_PIN = "test-pin"


@pytest.fixture(autouse=True)
def _isolated_env(tmp_path, monkeypatch):
    """Every test gets its own empty database and no real Telegram or RunPod settings."""
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("MANAGER_PIN", MANAGER_PIN)
    monkeypatch.setenv("EXTRACTION_MODE", "mock")
    for name in (
        "RUNPOD_ENDPOINT_URL",
        "RUNPOD_API_KEY",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_MANAGER_CHAT_ID",
        "TELEGRAM_STAFF_CHAT_ID",
    ):
        monkeypatch.delenv(name, raising=False)
    extraction._calls.clear()
    init_db()


@pytest.fixture
def client():
    # No `with`: the lifespan (and its demo seed) is skipped, so tests start from an empty catalogue.
    return TestClient(app)


@pytest.fixture
def manager():
    return {"X-Manager-Pin": MANAGER_PIN}


@pytest.fixture
def catalogue_ids(client, manager):
    """A small catalogue built through the API: one frozen product, one bundled product."""

    def post(path, body):
        resp = client.post(path, json=body, headers=manager)
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
