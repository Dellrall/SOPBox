"""Suppliers, quantity-only purchase orders, and receiving deliveries against them."""

from datetime import date, timedelta

import pytest

from conftest import sign_up

TODAY = date.today().isoformat()


@pytest.fixture
def supplier_id(client):
    resp = client.post("/api/suppliers", json={"name": "Fresh Mart", "phone": "03-1234 5678"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def order_body(ids, supplier_id, lines=None, **overrides):
    body = {
        "supplier_id": supplier_id,
        "order_date": TODAY,
        "lines": lines
        if lines is not None
        else [
            {"product_id": ids["fries"], "quantity": 2, "unit": "bdl"},
            {"product_id": ids["sausage"], "quantity": 40, "unit": "pcs"},
        ],
    }
    return {**body, **overrides}


def issued_order(client, ids, supplier_id, **kw):
    order = client.post("/api/purchase-orders", json=order_body(ids, supplier_id, **kw)).json()
    resp = client.post(f"/api/purchase-orders/{order['id']}/issue")
    assert resp.status_code == 200, resp.text
    return resp.json()


def receive(client, order_id, lines, supplier=""):
    return client.post(
        "/api/deliveries", json={"supplier": supplier, "purchase_order_id": order_id, "lines": lines}
    )


def fries(ids, qty, unit="bdl", **kw):
    return {"product_id": ids["fries"], "name": "Fries tray", "quantity": qty, "unit": unit, **kw}


def sausage(ids, qty, **kw):
    return {"product_id": ids["sausage"], "name": "Frozen sausage", "quantity": qty, "unit": "pcs", "temp_c": -15, **kw}


# ---- suppliers ----------------------------------------------------------------------------------


def test_suppliers_can_be_added_edited_and_archived(client, supplier_id):
    resp = client.put(f"/api/suppliers/{supplier_id}", json={"name": "Fresh Mart Sdn Bhd", "email": "Sales@FreshMart.my"})
    assert resp.json()["name"] == "Fresh Mart Sdn Bhd"
    assert resp.json()["email"] == "sales@freshmart.my"
    assert client.patch(f"/api/suppliers/{supplier_id}", json={"archived": True}).json()["archived"] is True


def test_a_supplier_name_is_unique(client, supplier_id):
    resp = client.post("/api/suppliers", json={"name": "fresh mart"})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "there is already a supplier with that name"


def test_staff_can_see_suppliers_and_orders_but_not_change_them(client, make_user, supplier_id, catalogue_ids):
    staff = make_user("staff")
    assert staff.get("/api/suppliers").status_code == 200
    assert staff.post("/api/suppliers", json={"name": "Other"}).status_code == 403
    assert staff.post("/api/purchase-orders", json=order_body(catalogue_ids, supplier_id)).status_code == 403
    assert staff.get("/api/purchase-orders").status_code == 200


# ---- writing orders -----------------------------------------------------------------------------


def test_an_order_is_numbered_and_fixes_the_pack_conversion(client, catalogue_ids, supplier_id):
    first = client.post("/api/purchase-orders", json=order_body(catalogue_ids, supplier_id)).json()
    second = client.post("/api/purchase-orders", json=order_body(catalogue_ids, supplier_id)).json()
    assert (first["reference"], second["reference"]) == ("PO-0001", "PO-0002")
    assert first["status"] == "draft"
    assert first["supplier"] == "Fresh Mart"
    by_product = {line["product_name"]: line for line in first["lines"]}
    assert by_product["Fries tray"]["ordered_base_qty"] == 500  # 2 bdl x 250
    assert by_product["Frozen sausage"]["ordered_base_qty"] == 40

    # Changing the pack size later does not change what was ordered.
    client.put(
        f"/api/products/{catalogue_ids['fries']}",
        json={"name": "Fries tray", "category_id": catalogue_ids["packaging_category"], "base_unit": "pcs",
              "pack_units": [{"unit": "bdl", "base_qty": 300}]},
    )
    again = client.get(f"/api/purchase-orders/{first['id']}").json()
    assert {line["product_name"]: line["ordered_base_qty"] for line in again["lines"]}["Fries tray"] == 500


@pytest.mark.parametrize(
    "change, message",
    [
        ({"lines": [{"product_id": 0, "quantity": 1, "unit": "pcs"}]}, "unknown or archived"),
        ("bad-unit", "not defined"),
        ("duplicate", "each product can appear once"),
        ({"expected_date": (date.today() - timedelta(days=1)).isoformat()}, "cannot be before"),
        ({"lines": []}, ""),
    ],
)
def test_order_input_is_checked(client, catalogue_ids, supplier_id, change, message):
    ids = catalogue_ids
    if change == "bad-unit":
        change = {"lines": [{"product_id": ids["sausage"], "quantity": 1, "unit": "crate"}]}
    elif change == "duplicate":
        line = {"product_id": ids["sausage"], "quantity": 1, "unit": "pcs"}
        change = {"lines": [line, line]}
    resp = client.post("/api/purchase-orders", json=order_body(ids, supplier_id, **change))
    assert resp.status_code == 422
    assert message in resp.text


def test_an_archived_supplier_or_product_cannot_be_ordered(client, catalogue_ids, supplier_id):
    client.patch(f"/api/products/{catalogue_ids['sausage']}", json={"archived": True})
    resp = client.post("/api/purchase-orders", json=order_body(catalogue_ids, supplier_id))
    assert resp.status_code == 422
    client.patch(f"/api/suppliers/{supplier_id}", json={"archived": True})
    lines = [{"product_id": catalogue_ids["fries"], "quantity": 1, "unit": "bdl"}]
    resp = client.post("/api/purchase-orders", json=order_body(catalogue_ids, supplier_id, lines=lines))
    assert resp.status_code == 422
    assert "active supplier" in resp.text


def test_only_a_draft_can_be_edited_or_issued(client, catalogue_ids, supplier_id):
    order = client.post("/api/purchase-orders", json=order_body(catalogue_ids, supplier_id)).json()
    edited = client.put(f"/api/purchase-orders/{order['id']}", json=order_body(catalogue_ids, supplier_id, notes="Back door"))
    assert edited.json()["notes"] == "Back door"
    issued = client.post(f"/api/purchase-orders/{order['id']}/issue").json()
    assert issued["status"] == "issued" and issued["issued_by"] == "Olive Owner"
    assert client.put(f"/api/purchase-orders/{order['id']}", json=order_body(catalogue_ids, supplier_id)).status_code == 409
    assert client.post(f"/api/purchase-orders/{order['id']}/issue").status_code == 409


def test_orders_are_audited(client, catalogue_ids, supplier_id):
    issued_order(client, catalogue_ids, supplier_id)
    actions = [e["action"] for e in client.get("/api/audit").json()]
    assert "po.created" in actions and "po.issued" in actions


# ---- receiving against an order -----------------------------------------------------------------


def test_receiving_exactly_what_was_ordered_is_accepted_and_completes_the_order(client, catalogue_ids, supplier_id):
    ids = catalogue_ids
    order = issued_order(client, ids, supplier_id)
    resp = receive(client, order["id"], [fries(ids, 2), sausage(ids, 40)])
    assert resp.status_code == 201, resp.text
    delivery = resp.json()
    assert delivery["status"] == "accepted"
    assert delivery["purchase_order"] == "PO-0001"
    assert delivery["supplier"] == "Fresh Mart"  # taken from the order when left blank

    after = client.get(f"/api/purchase-orders/{order['id']}").json()
    assert after["receiving_status"] == "fully_received"
    assert all(line["outstanding_base_qty"] == 0 for line in after["lines"])
    assert after["delivery_ids"] == [delivery["id"]]

    again = receive(client, order["id"], [fries(ids, 1)])
    assert again.status_code == 422
    assert "fully received" in again.json()["detail"]


def test_a_short_delivery_waits_for_a_manager_and_the_rest_stays_outstanding(client, catalogue_ids, supplier_id):
    ids = catalogue_ids
    order = issued_order(client, ids, supplier_id)
    # The person receiving says 1 is expected; the order says 2 bdl (500 pcs). The order wins.
    short = receive(client, order["id"], [fries(ids, 1, expected_base_qty=250)]).json()
    assert short["status"] == "pending_approval"
    line = short["lines"][0]
    assert line["expected_base_qty"] == 500
    assert "received 250 pcs, expected 500" in " ".join(line["issues"])

    waiting = client.get(f"/api/purchase-orders/{order['id']}").json()
    fries_line = next(l for l in waiting["lines"] if l["product_name"] == "Fries tray")
    assert (fries_line["pending_base_qty"], fries_line["outstanding_base_qty"]) == (250, 250)

    client.post(f"/api/deliveries/{short['id']}/decision", json={"decision": "accept"})
    after = client.get(f"/api/purchase-orders/{order['id']}").json()
    assert after["receiving_status"] == "partially_received"
    fries_line = next(l for l in after["lines"] if l["product_name"] == "Fries tray")
    assert (fries_line["received_base_qty"], fries_line["outstanding_base_qty"]) == (250, 250)

    # The next delivery is checked against what is still outstanding.
    rest = receive(client, order["id"], [fries(ids, 1), sausage(ids, 40)]).json()
    assert rest["status"] == "accepted"
    assert client.get(f"/api/purchase-orders/{order['id']}").json()["receiving_status"] == "fully_received"


def test_a_rejected_delivery_does_not_count_against_the_order(client, catalogue_ids, supplier_id):
    ids = catalogue_ids
    order = issued_order(client, ids, supplier_id)
    warm = receive(client, order["id"], [sausage(ids, 40, temp_c=-2)]).json()
    assert warm["status"] == "pending_approval"
    client.post(f"/api/deliveries/{warm['id']}/decision", json={"decision": "reject", "reason": "Thawed"})
    after = client.get(f"/api/purchase-orders/{order['id']}").json()
    line = next(l for l in after["lines"] if l["product_name"] == "Frozen sausage")
    assert (line["received_base_qty"], line["pending_base_qty"], line["outstanding_base_qty"]) == (0, 0, 40)


def test_a_product_not_on_the_order_fails(client, catalogue_ids, supplier_id):
    ids = catalogue_ids
    order = issued_order(client, ids, supplier_id, lines=[{"product_id": ids["fries"], "quantity": 2, "unit": "bdl"}])
    delivery = receive(client, order["id"], [fries(ids, 2), sausage(ids, 10)]).json()
    assert delivery["status"] == "pending_approval"
    issues = {l["name"]: l["issues"] for l in delivery["lines"]}
    assert issues["Fries tray"] == []
    assert issues["Frozen sausage"] == ["not on PO-0001"]


def test_only_an_issued_order_can_be_received(client, catalogue_ids, supplier_id):
    ids = catalogue_ids
    draft = client.post("/api/purchase-orders", json=order_body(ids, supplier_id)).json()
    resp = receive(client, draft["id"], [fries(ids, 2)])
    assert resp.status_code == 422
    assert "only an issued purchase order" in resp.json()["detail"]
    assert receive(client, 9999, [fries(ids, 2)]).status_code == 404


def test_cancelling(client, catalogue_ids, supplier_id):
    ids = catalogue_ids
    draft = client.post("/api/purchase-orders", json=order_body(ids, supplier_id)).json()
    cancelled = client.post(f"/api/purchase-orders/{draft['id']}/cancel", json={"reason": "Wrong supplier"})
    assert cancelled.json()["status"] == "cancelled"
    assert receive(client, draft["id"], [fries(ids, 2)]).status_code == 422

    order = issued_order(client, ids, supplier_id)
    receive(client, order["id"], [fries(ids, 2)])
    refused = client.post(f"/api/purchase-orders/{order['id']}/cancel", json={})
    assert refused.status_code == 409
    assert "already received" in refused.json()["detail"]


def test_a_product_on_an_order_cannot_be_deleted(client, catalogue_ids, supplier_id):
    client.post("/api/purchase-orders", json=order_body(catalogue_ids, supplier_id))
    resp = client.delete(f"/api/products/{catalogue_ids['fries']}")
    assert resp.status_code == 409
    assert "purchase orders" in resp.json()["detail"]


# ---- low stock ----------------------------------------------------------------------------------


def test_low_stock_drafts_an_order_for_the_shortfall_once(client, catalogue_ids, supplier_id):
    # Frozen sausage: stock 0, minimum 50.
    draft = client.post("/api/purchase-orders/low-stock-draft", json={"supplier_id": supplier_id})
    assert draft.status_code == 201, draft.text
    lines = draft.json()["lines"]
    assert [(l["product_name"], l["quantity"], l["unit"]) for l in lines] == [("Frozen sausage", 50, "pcs")]
    # The shortfall is on an open order now, so a second press has nothing to add.
    again = client.post("/api/purchase-orders/low-stock-draft", json={"supplier_id": supplier_id})
    assert again.status_code == 422
    assert "nothing needs reordering" in again.json()["detail"]


# ---- isolation ----------------------------------------------------------------------------------


def test_another_workspace_cannot_see_or_receive_an_order(client, catalogue_ids, supplier_id):
    order = issued_order(client, catalogue_ids, supplier_id)
    other = sign_up(workspace="Other Cafe", username="otto")
    assert other.get(f"/api/purchase-orders/{order['id']}").status_code == 404
    assert other.get("/api/purchase-orders").json() == []
    assert other.get("/api/suppliers").json() == []
    resp = other.post("/api/deliveries", json={"purchase_order_id": order["id"], "lines": [{"name": "x", "quantity": 1, "unit": "pcs"}]})
    assert resp.status_code == 404
