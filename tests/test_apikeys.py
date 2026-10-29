"""API keys: a till records sales and reads stock in one storage area, and nothing else."""

from fastapi.testclient import TestClient

from conftest import sign_up
from app.main import app
from test_locations import _count, _second_outlet, _stock, _storages, _with_code


def _key(client, storage_id, name="Till 1"):
    made = client.post("/api/api-keys", json={"name": name, "storage_id": storage_id})
    assert made.status_code == 201, made.text
    return made.json()


def _till(key):
    return TestClient(app, headers={"Authorization": f"Bearer {key}"})


def test_a_till_records_sales_by_code_and_a_resent_reference_changes_nothing(client, catalogue_ids):
    fries = catalogue_ids["fries"]
    _with_code(client, fries, "1001")
    store = _storages(client)["Main outlet / Store"]
    _count(client, store, fries, 0, 10)
    made = _key(client, store)
    assert made["key"].startswith("sopbox_") and made["hint"] == made["key"][-4:]
    assert "key" not in client.get("/api/api-keys").json()[0]

    till = _till(made["key"])
    sale = {"sale_date": "2026-10-29", "reference": "R-77",
            "lines": [{"code": "1001", "quantity": 2}, {"code": "1001", "quantity": 1}, {"code": "999", "quantity": 4}]}
    sent = till.post("/api/v1/sales", json=sale)
    assert sent.status_code == 201, sent.text
    assert sent.json()["unknown_codes"] == ["999"]
    assert [(line["product_code"], line["quantity"]) for line in sent.json()["sale"]["lines"]] == [("1001", 3)]
    again = till.post("/api/v1/sales", json=sale)
    assert again.json()["sale"]["reference"] == sent.json()["sale"]["reference"]
    assert _stock(client, store, fries)["quantity"] == 7

    stock = till.get("/api/v1/stock")
    assert stock.status_code == 200
    assert next(r for r in stock.json() if r["product_id"] == fries)["quantity"] == 7
    assert client.get("/api/api-keys").json()[0]["last_used_at"] is not None
    actions = [e["action"] for e in client.get("/api/audit").json()]
    assert "api_key.created" in actions and "sales.recorded" in actions


def test_a_key_only_works_on_the_till_api_and_stops_when_revoked(client, catalogue_ids):
    storages = _second_outlet(client)
    made = _key(client, storages["Outlet KL / Store"])
    till = _till(made["key"])
    assert till.get("/api/products").status_code == 401  # not a sign-in
    assert till.get("/api/api-keys").status_code == 401
    assert till.get("/api/v1/stock").status_code == 200

    assert client.delete(f"/api/api-keys/{made['id']}").json() == []
    assert till.get("/api/v1/stock").status_code == 401
    assert _till("sopbox_wrong").get("/api/v1/stock").status_code == 401
    assert TestClient(app).get("/api/v1/stock").status_code == 401


def test_only_managers_make_keys_and_only_for_their_own_storage(client, catalogue_ids, make_user):
    staff = make_user("staff")
    store = _storages(client)["Main outlet / Store"]
    assert staff.post("/api/api-keys", json={"name": "x", "storage_id": store}).status_code == 403

    other = sign_up(workspace="Other Kitchen", username="otto")
    assert other.post("/api/api-keys", json={"name": "x", "storage_id": store}).status_code == 422
    mine = _key(client, store)
    assert other.delete(f"/api/api-keys/{mine['id']}").status_code == 404
    assert other.get("/api/api-keys").json() == []


def test_a_sale_with_no_known_codes_is_refused(client, catalogue_ids):
    till = _till(_key(client, _storages(client)["Main outlet / Store"])["key"])
    resp = till.post("/api/v1/sales", json={"sale_date": "2026-10-29", "lines": [{"code": "nope", "quantity": 1}]})
    assert resp.status_code == 422 and "nope" in resp.json()["detail"]
