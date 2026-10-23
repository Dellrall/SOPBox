"""The receiving journey: check, hold failures for a manager, log every step."""

import pytest


def receive(client, ids, *lines, received_by="Aina", supplier="Fresh Foods"):
    resp = client.post(
        "/api/deliveries", json={"received_by": received_by, "supplier": supplier, "lines": list(lines)}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def sausage_line(ids, **overrides):
    line = {"product_id": ids["sausage"], "name": "Frozen sausage", "quantity": 60, "unit": "pcs", "temp_c": -15}
    return {**line, **overrides}


def fries_line(ids, **overrides):
    line = {"product_id": ids["fries"], "name": "Fries tray", "quantity": 2, "unit": "bdl"}
    return {**line, **overrides}


def stock(client, product_id):
    return client.get(f"/api/products/{product_id}").json()["stock"]


def decide(client, manager, delivery_id, **body):
    payload = {"decision": "accept", "decided_by": "Mr Tan", **body}
    return client.post(f"/api/deliveries/{delivery_id}/decision", json=payload, headers=manager)


# ---- happy path -------------------------------------------------------------------------------


def test_a_delivery_that_passes_every_check_is_accepted_and_stocked(client, catalogue_ids):
    ids = catalogue_ids
    delivery = receive(client, ids, sausage_line(ids), fries_line(ids, expected_base_qty=500))

    assert delivery["status"] == "accepted"
    assert all(line["passed"] for line in delivery["lines"])
    assert stock(client, ids["sausage"]) == 60
    assert stock(client, ids["fries"]) == 500  # 2 bundles x 250


def test_low_stock_clears_once_enough_arrives(client, catalogue_ids):
    ids = catalogue_ids
    assert client.get(f"/api/products/{ids['sausage']}").json()["low_stock"] is True
    receive(client, ids, sausage_line(ids, quantity=60))
    assert client.get(f"/api/products/{ids['sausage']}").json()["low_stock"] is False


def test_two_lines_for_the_same_product_both_count(client, catalogue_ids):
    ids = catalogue_ids
    receive(client, ids, sausage_line(ids, quantity=10), sausage_line(ids, quantity=15))
    assert stock(client, ids["sausage"]) == 25


# ---- fail path --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("line_overrides", "issue"),
    [
        ({"temp_c": -5}, "outside -20 to -10 C"),
        ({"temp_c": None}, "temperature missing"),
        ({"unit": "box"}, "not defined"),
        ({"expected_base_qty": 100}, "expected 100"),
    ],
)
def test_a_failed_check_holds_the_delivery_and_leaves_stock_alone(
    client, catalogue_ids, line_overrides, issue
):
    ids = catalogue_ids
    delivery = receive(client, ids, sausage_line(ids, **line_overrides))

    assert delivery["status"] == "pending_approval"
    assert issue in delivery["lines"][0]["issues"][0]
    assert stock(client, ids["sausage"]) == 0


def test_one_bad_line_holds_the_whole_delivery(client, catalogue_ids):
    ids = catalogue_ids
    delivery = receive(client, ids, sausage_line(ids), sausage_line(ids, temp_c=0))
    assert delivery["status"] == "pending_approval"
    assert [line["passed"] for line in delivery["lines"]] == [True, False]
    assert stock(client, ids["sausage"]) == 0  # nothing is stocked until a manager decides


def test_a_line_staff_could_not_match_goes_to_a_manager(client, catalogue_ids):
    line = {"product_id": None, "name": "Mystery sauce", "quantity": 3, "unit": "box"}
    delivery = receive(client, catalogue_ids, line)
    assert delivery["status"] == "pending_approval"
    assert delivery["lines"][0]["issues"] == ["unrecognised product"]


def test_an_unknown_product_id_is_rejected(client, catalogue_ids):
    ids = catalogue_ids
    resp = client.post(
        "/api/deliveries", json={"received_by": "Aina", "lines": [sausage_line(ids, product_id=9999)]}
    )
    assert resp.status_code == 422


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(lines=[]),
        lambda d: d.update(received_by="  "),
        lambda d: d["lines"][0].update(quantity=0),
        lambda d: d["lines"][0].update(temp_c=150),
    ],
)
def test_invalid_deliveries_are_rejected(client, catalogue_ids, mutate):
    body = {"received_by": "Aina", "lines": [sausage_line(catalogue_ids)]}
    mutate(body)
    assert client.post("/api/deliveries", json=body).status_code == 422


# ---- manager decision -------------------------------------------------------------------------


def held_delivery(client, ids):
    # 2 bundles of fries = 500 pcs, but 400 were expected: a quantity mismatch.
    delivery = receive(client, ids, fries_line(ids, expected_base_qty=400))
    assert delivery["status"] == "pending_approval"
    return delivery["id"]


def test_accepting_a_held_delivery_stocks_what_actually_arrived(client, manager, catalogue_ids):
    ids = catalogue_ids
    delivery_id = held_delivery(client, ids)

    resp = decide(client, manager, delivery_id, reason="Supplier confirmed the extra bundle")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "accepted"
    assert body["decided_by"] == "Mr Tan"
    assert body["decision_reason"] == "Supplier confirmed the extra bundle"
    assert stock(client, ids["fries"]) == 500  # received, not expected


@pytest.mark.parametrize(("decision", "status"), [("reject", "rejected"), ("return", "returned")])
def test_rejecting_or_returning_does_not_touch_stock(
    client, manager, catalogue_ids, decision, status
):
    ids = catalogue_ids
    delivery_id = held_delivery(client, ids)

    resp = decide(client, manager, delivery_id, decision=decision, reason="Short by 100")
    assert resp.json()["status"] == status
    assert stock(client, ids["fries"]) == 0


@pytest.mark.parametrize("decision", ["reject", "return"])
def test_rejecting_or_returning_needs_a_reason(client, manager, catalogue_ids, decision):
    delivery_id = held_delivery(client, catalogue_ids)
    resp = decide(client, manager, delivery_id, decision=decision)
    assert resp.status_code == 422
    assert client.get(f"/api/deliveries/{delivery_id}").json()["status"] == "pending_approval"


def test_a_delivery_can_only_be_decided_once(client, manager, catalogue_ids):
    ids = catalogue_ids
    delivery_id = held_delivery(client, ids)
    assert decide(client, manager, delivery_id).status_code == 200
    assert decide(client, manager, delivery_id).status_code == 409
    assert stock(client, ids["fries"]) == 500  # not added twice


def test_an_auto_accepted_delivery_cannot_be_decided(client, manager, catalogue_ids):
    delivery = receive(client, catalogue_ids, sausage_line(catalogue_ids))
    assert decide(client, manager, delivery["id"]).status_code == 409


def test_deciding_an_unknown_delivery_is_404(client, manager):
    assert decide(client, manager, 9999).status_code == 404


def test_deciding_needs_the_manager_pin(client, catalogue_ids):
    delivery_id = held_delivery(client, catalogue_ids)
    resp = client.post(
        f"/api/deliveries/{delivery_id}/decision", json={"decision": "accept", "decided_by": "Aina"}
    )
    assert resp.status_code == 401


# ---- reading ----------------------------------------------------------------------------------


def test_list_filters_by_status_newest_first(client, manager, catalogue_ids):
    ids = catalogue_ids
    first = receive(client, ids, sausage_line(ids))
    held = held_delivery(client, ids)

    assert [d["id"] for d in client.get("/api/deliveries").json()] == [held, first["id"]]
    pending = client.get("/api/deliveries", params={"status": "pending_approval"}).json()
    assert [d["id"] for d in pending] == [held]
    assert client.get("/api/deliveries", params={"status": "bogus"}).status_code == 422


def test_get_delivery_by_id(client, catalogue_ids):
    delivery = receive(client, catalogue_ids, sausage_line(catalogue_ids))
    fetched = client.get(f"/api/deliveries/{delivery['id']}").json()
    assert fetched == delivery
    assert client.get("/api/deliveries/9999").status_code == 404


# ---- audit log --------------------------------------------------------------------------------


def test_every_step_is_logged_with_who_and_what(client, manager, catalogue_ids):
    ids = catalogue_ids
    receive(client, ids, sausage_line(ids), received_by="Aina")
    delivery_id = held_delivery(client, ids)
    decide(client, manager, delivery_id, decision="reject", reason="Short by 100")

    entries = client.get("/api/audit").json()
    summary = [(e["actor"], e["action"], e["delivery_id"]) for e in reversed(entries)]
    assert summary == [
        ("Aina", "delivery.received", 1),
        ("system", "delivery.accepted", 1),
        ("Aina", "delivery.received", 2),
        ("Mr Tan", "delivery.rejected", 2),
    ]
    assert entries[0]["detail"] == "Short by 100"
    assert all(e["at"] for e in entries)
