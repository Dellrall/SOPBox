"""Access rules and the basics every route depends on."""

import pytest


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


@pytest.mark.parametrize("headers", [{}, {"X-Manager-Pin": "wrong"}])
def test_manager_routes_reject_a_missing_or_wrong_pin(client, headers):
    resp = client.post("/api/categories", json={"name": "Frozen"}, headers=headers)
    assert resp.status_code == 401


def test_manager_routes_are_disabled_when_no_pin_is_configured(client, monkeypatch):
    monkeypatch.setenv("MANAGER_PIN", "")
    resp = client.post(
        "/api/categories", json={"name": "Frozen"}, headers={"X-Manager-Pin": "anything"}
    )
    assert resp.status_code == 503


def test_reads_need_no_pin(client):
    for path in ("/api/categories", "/api/products", "/api/deliveries", "/api/audit"):
        assert client.get(path).status_code == 200, path


def test_staff_cannot_change_the_catalogue_or_decide_deliveries(client, catalogue_ids):
    product_id = catalogue_ids["sausage"]
    body = {"name": "Frozen sausage", "category_id": catalogue_ids["frozen_category"], "base_unit": "pcs"}
    assert client.put(f"/api/products/{product_id}", json=body).status_code == 401
    assert client.delete(f"/api/products/{product_id}").status_code == 401
    decision = {"decision": "accept", "decided_by": "Sam"}
    assert client.post("/api/deliveries/1/decision", json=decision).status_code == 401
