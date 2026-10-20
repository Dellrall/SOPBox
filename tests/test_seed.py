"""The demo catalogue must match the hackathon brief where the brief gives numbers."""

import pytest

from app import catalogue
from app.db import connect
from app.seed import seed_if_empty


@pytest.fixture
def seeded():
    conn = connect()
    try:
        assert seed_if_empty(conn) is True
        yield {p.name: p for p in catalogue.list_products(conn)}, conn
    finally:
        conn.close()


def test_the_demo_has_ten_products(seeded):
    products, _ = seeded
    assert len(products) == 10


def test_seeding_runs_only_once(seeded):
    _, conn = seeded
    assert seed_if_empty(conn) is False
    assert len(catalogue.list_products(conn)) == 10


@pytest.mark.parametrize(
    ("name", "low", "high"),
    [("Frozen sausage", -20, -10), ("Chocolate ball", -10, 0), ("Nugget", -20, -10)],
)
def test_temperature_ranges_from_the_brief(seeded, name, low, high):
    products, _ = seeded
    assert (products[name].effective_temp_min_c, products[name].effective_temp_max_c) == (low, high)


@pytest.mark.parametrize(
    ("name", "unit", "base_qty"),
    [("Fries tray", "bdl", 250), ("Hot dog box", "bdl", 100), ("Nugget", "box", 12)],
)
def test_pack_sizes_from_the_brief(seeded, name, unit, base_qty):
    products, _ = seeded
    assert {p.unit: p.base_qty for p in products[name].pack_units}[unit] == base_qty


def test_coke_is_counted_in_boxes_until_the_team_agrees_the_conversion(seeded):
    products, _ = seeded
    assert products["Coke"].base_unit == "box"
    assert products["Coke"].pack_units == []


def test_every_product_has_an_sop_card(seeded):
    products, _ = seeded
    assert all(p.sop.strip() for p in products.values())


def test_the_demo_shows_both_low_and_healthy_stock(seeded):
    products, _ = seeded
    low = [name for name, p in products.items() if p.low_stock]
    assert "Nugget" in low
    assert len(low) < len(products)


def test_the_app_seeds_an_empty_database_on_startup(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:  # `with` runs the lifespan
        assert len(client.get("/api/products").json()) == 10
