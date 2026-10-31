"""Outlets and storage areas, stock per storage area, transfers, uploaded sales and product codes."""

import psycopg

from conftest import sign_up


def _storages(client):
    outlets = client.get("/api/outlets")
    assert outlets.status_code == 200, outlets.text
    return {s["label"]: s["id"] for o in outlets.json() for s in o["storages"]}


def _stock(client, storage_id, product_id):
    rows = client.get(f"/api/storages/{storage_id}/stock").json()
    return next(r for r in rows if r["product_id"] == product_id)


def _count(client, storage_id, product_id, expected, counted):
    resp = client.post(
        "/api/stocktakes",
        json={
            "count_date": "2026-10-29",
            "storage_id": storage_id,
            "lines": [{"product_id": product_id, "expected_stock": expected, "counted_stock": counted}],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _second_outlet(client):
    resp = client.post("/api/outlets", json={"name": "Outlet KL"})
    assert resp.status_code == 201, resp.text
    return _storages(client)


def test_stock_from_before_storage_areas_moves_into_the_first_store(client, catalogue_ids, _database):
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("UPDATE products SET stock = 40 WHERE id = %s", (catalogue_ids["fries"],))

    storages = _storages(client)
    assert list(storages) == ["Main outlet / Store"]
    assert _stock(client, storages["Main outlet / Store"], catalogue_ids["fries"])["quantity"] == 40


def test_each_storage_area_keeps_its_own_stock_and_the_total_adds_up(client, catalogue_ids):
    fries = catalogue_ids["fries"]
    storages = _second_outlet(client)
    store, kl = storages["Main outlet / Store"], storages["Outlet KL / Store"]
    assert client.post("/api/storages", json={"outlet_id": client.get("/api/outlets").json()[1]["id"], "name": "Substore"}).status_code == 201

    count = _count(client, kl, fries, 0, 30)
    assert count["storage"] == "Outlet KL / Store"
    _count(client, store, fries, 0, 10)
    delivery = client.post(
        "/api/deliveries",
        json={"storage_id": store, "lines": [{"product_id": fries, "name": "Fries tray", "quantity": 1, "unit": "bdl"}]},
    )
    assert delivery.status_code == 201, delivery.text
    assert delivery.json()["storage"] == "Main outlet / Store"

    assert _stock(client, store, fries)["quantity"] == 260
    assert _stock(client, kl, fries)["quantity"] == 30
    assert _stock(client, kl, fries)["total"] == 30  # the whole of Outlet KL
    assert _stock(client, store, fries)["total"] == 260  # the whole of Main outlet
    # Counting one storage area compares against that area only.
    stale = client.post(
        "/api/stocktakes",
        json={"count_date": "2026-10-29", "storage_id": kl,
              "lines": [{"product_id": fries, "expected_stock": 290, "counted_stock": 5}]},
    )
    assert stale.status_code == 409


def test_a_transfer_moves_stock_and_refuses_more_than_the_source_holds(client, catalogue_ids):
    fries = catalogue_ids["fries"]
    storages = _second_outlet(client)
    store, kl = storages["Main outlet / Store"], storages["Outlet KL / Store"]
    _count(client, store, fries, 0, 10)

    moved = client.post(
        "/api/transfers",
        json={"from_storage_id": store, "to_storage_id": kl, "notes": "weekend rush",
              "lines": [{"product_id": fries, "quantity": 4}]},
    )
    assert moved.status_code == 201, moved.text
    assert moved.json()["reference"] == "TR-000001"
    assert moved.json()["from_storage"] == "Main outlet / Store"
    assert moved.json()["lines"][0]["quantity"] == 4
    assert _stock(client, store, fries)["quantity"] == 6
    assert _stock(client, kl, fries) | {"quantity": 4, "total": 4} == _stock(client, kl, fries)  # KL holds only what moved in

    too_much = client.post(
        "/api/transfers",
        json={"from_storage_id": store, "to_storage_id": kl, "lines": [{"product_id": fries, "quantity": 7}]},
    )
    assert too_much.status_code == 409
    assert "only has 6" in too_much.json()["detail"]
    same = client.post(
        "/api/transfers",
        json={"from_storage_id": store, "to_storage_id": store, "lines": [{"product_id": fries, "quantity": 1}]},
    )
    assert same.status_code == 422
    assert len(client.get("/api/transfers").json()) == 1
    assert any(a["action"] == "stock.transferred" for a in client.get("/api/audit").json())


def test_staff_who_can_only_view_stock_cannot_transfer(client, catalogue_ids, make_user):
    storages = _second_outlet(client)
    staff = make_user()
    assert staff.get("/api/transfers").status_code == 200
    resp = staff.post(
        "/api/transfers",
        json={"from_storage_id": storages["Main outlet / Store"], "to_storage_id": storages["Outlet KL / Store"],
              "lines": [{"product_id": catalogue_ids["fries"], "quantity": 1}]},
    )
    assert resp.status_code == 403
    assert staff.post("/api/outlets", json={"name": "Sneaky"}).status_code == 403


def test_transfers_and_sales_have_their_own_access(client, catalogue_ids, make_user):
    storages = _second_outlet(client)
    staff = make_user()
    user_id = staff.get("/api/auth/me").json()["id"]
    transfer = {"from_storage_id": storages["Main outlet / Store"], "to_storage_id": storages["Outlet KL / Store"],
                "lines": [{"product_id": catalogue_ids["fries"], "quantity": 1}]}

    # Saved before the split: transfers and sales follow the stock count level.
    old = client.patch(f"/api/users/{user_id}", json={"section_access": {"stocktake": "none"}}).json()
    assert (old["section_access"]["transfers"], old["section_access"]["sales"]) == ("none", "none")
    assert staff.get("/api/sales").status_code == 403

    client.patch(f"/api/users/{user_id}", json={"section_access": {"stocktake": "none", "transfers": "edit", "sales": "view"}})
    assert staff.get("/api/stocktakes").status_code == 403
    assert staff.get(f"/api/storages/{storages['Main outlet / Store']}/stock").status_code == 200
    assert staff.post("/api/transfers", json=transfer).status_code != 403
    assert staff.get("/api/sales").status_code == 200
    assert staff.post("/api/sales/confirm", json={}).status_code == 403


def test_a_storage_area_holding_stock_or_with_history_is_not_deleted(client, catalogue_ids):
    storages = _second_outlet(client)
    store, kl = storages["Main outlet / Store"], storages["Outlet KL / Store"]
    _count(client, kl, catalogue_ids["fries"], 0, 3)
    assert client.delete(f"/api/storages/{kl}").status_code == 409  # holds stock
    _count(client, kl, catalogue_ids["fries"], 3, 0)
    history = client.delete(f"/api/storages/{kl}")
    assert history.status_code == 409 and "rename it instead" in history.json()["detail"]

    outlet = client.get("/api/outlets").json()[1]
    empty = client.post("/api/storages", json={"outlet_id": outlet["id"], "name": "Chiller"}).json()
    chiller = next(s["id"] for o in empty for s in o["storages"] if s["name"] == "Chiller")
    assert client.delete(f"/api/storages/{chiller}").status_code == 200
    assert client.put(f"/api/storages/{store}", json={"name": "Dry store"}).status_code == 200
    assert "Main outlet / Dry store" in _storages(client)


def _with_code(client, product_id, code):
    product = client.get(f"/api/products/{product_id}").json()
    body = {k: product[k] for k in ("name", "category_id", "base_unit", "temp_min_c", "temp_max_c", "min_stock", "sop", "pack_units")}
    return client.put(f"/api/products/{product_id}", json={**body, "code": code})


def test_product_codes_are_unique_in_a_workspace(client, catalogue_ids):
    assert _with_code(client, catalogue_ids["fries"], "FR-01").json()["code"] == "FR-01"
    clash = _with_code(client, catalogue_ids["sausage"], "fr-01")
    assert clash.status_code == 409 and "code" in clash.json()["detail"]
    assert _with_code(client, catalogue_ids["sausage"], "").json()["code"] is None
    assert [p["code"] for p in client.get("/api/products?q=fr-0").json()] == ["FR-01"]


def test_uploaded_sales_come_off_one_storage_area(client, catalogue_ids):
    fries, sausage = catalogue_ids["fries"], catalogue_ids["sausage"]
    _with_code(client, fries, "1001")
    _with_code(client, sausage, "SA-9")
    store = _storages(client)["Main outlet / Store"]
    _count(client, store, fries, 0, 10)
    _count(client, store, sausage, 0, 50)

    sheet = "Daily sales\nSKU,Item,Qty\n1001,Fries,4\n1001,Fries,8\nsa-9,Sausage,5\n7777,Mystery,2\n"
    preview = client.post(
        f"/api/sales/preview?storage_id={store}", files={"file": ("pos.csv", sheet.encode(), "text/csv")}
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["unknown_codes"] == ["7777"]
    assert [(line["code"], line["quantity"], line["in_stock"]) for line in body["lines"]] == [
        ("1001", 12, 10),
        ("SA-9", 5, 50),
    ]

    saved = client.post(
        "/api/sales",
        json={"storage_id": store, "sale_date": "2026-10-29", "source": "pos.csv",
              "lines": [{"product_id": line["product_id"], "quantity": line["quantity"]} for line in body["lines"]]},
    )
    assert saved.status_code == 201, saved.text
    assert saved.json()["reference"] == "SA-000001"
    assert {line["product_code"]: (line["quantity"], line["deducted"]) for line in saved.json()["lines"]} == {
        "1001": (12, 10),  # more sold than held: stock stops at 0 and the gap is kept
        "SA-9": (5, 5),
    }
    assert _stock(client, store, fries)["quantity"] == 0
    assert _stock(client, store, sausage)["quantity"] == 45
    assert client.get("/api/sales").json()[0]["storage"] == "Main outlet / Store"
    template = client.get("/api/sales/template.csv")
    assert template.status_code == 200 and "1001,Fries tray," in template.content.decode("utf-8-sig")


def test_a_sales_sheet_needs_code_and_quantity_columns(client, catalogue_ids):
    store = _storages(client)["Main outlet / Store"]
    resp = client.post(
        f"/api/sales/preview?storage_id={store}", files={"file": ("pos.csv", b"Name,Amount\nFries,3\n", "text/csv")}
    )
    assert resp.status_code == 422
    assert "Product code" in resp.json()["detail"]


def test_storage_areas_of_another_workspace_cannot_be_used(client, catalogue_ids):
    other = sign_up(workspace="Other Kitchen", username="otto")
    theirs = _storages(other)["Main outlet / Store"]
    assert client.get(f"/api/storages/{theirs}/stock").status_code == 422
    assert client.delete(f"/api/storages/{theirs}").status_code == 422
