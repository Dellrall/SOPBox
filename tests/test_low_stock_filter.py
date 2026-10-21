"""Starter task: `GET /api/products?low_stock=true` lists only products below their minimum."""

import pytest

pytestmark = pytest.mark.xfail(reason="TODO: implement the low_stock filter", strict=True)


def test_low_stock_true_returns_only_products_below_minimum(client, catalogue_ids):
    # Frozen sausage has min_stock 50 and stock 0; Fries tray has min_stock 0.
    names = [p["name"] for p in client.get("/api/products", params={"low_stock": True}).json()]
    assert names == ["Frozen sausage"]


def test_low_stock_false_returns_only_products_at_or_above_minimum(client, catalogue_ids):
    names = [p["name"] for p in client.get("/api/products", params={"low_stock": False}).json()]
    assert names == ["Fries tray"]


def test_no_filter_still_returns_everything(client, catalogue_ids):
    assert len(client.get("/api/products").json()) == 2
