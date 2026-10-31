"""Expiry dates on deliveries, lots worked out first expiry first out, transfers, alerts and disposal."""

from datetime import date, timedelta


def _day(n):
    return (date.today() + timedelta(days=n)).isoformat()


def _receive(client, product_id, quantity, storage_id=None, **line):
    resp = client.post(
        "/api/deliveries",
        json={
            "supplier": "Dairy Farm",
            "storage_id": storage_id,
            "lines": [{"product_id": product_id, "name": "Milk", "quantity": quantity, "unit": "btl", **line}],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _lots(client, product_id):
    resp = client.get("/api/lots")
    assert resp.status_code == 200, resp.text
    return [lot for lot in resp.json() if lot["product_id"] == product_id]


def test_lots_follow_first_expiry_first_out(client, catalogue_ids):
    milk = client.post(
        "/api/products",
        json={"name": "Milk", "category_id": catalogue_ids["packaging_category"], "base_unit": "btl",
              "track_expiry": True, "min_days_left": 3, "warn_days": 2},
    ).json()["id"]

    # No date, or too few days left: held for a manager.
    held = _receive(client, milk, 1)
    assert held["status"] == "pending_approval" and held["lines"][0]["issues"] == ["expiry date missing"]
    short = _receive(client, milk, 1, expiry_on=_day(1))
    assert short["lines"][0]["issues"] == ["only 1 day(s) before expiry, needs at least 3"]

    later = _receive(client, milk, 5, expiry_later=True)
    assert later["status"] == "accepted" and later["lines"][0]["expiry_later"]
    _receive(client, milk, 10, expiry_on=_day(10))
    _receive(client, milk, 4, expiry_on=_day(20))
    lots = _lots(client, milk)
    assert [(lot["status"], lot["left"]) for lot in lots] == [("no_date", 5), ("ok", 10), ("ok", 4)]
    assert lots[1]["supplier"] == "Dairy Farm" and lots[1]["location"] == "Main outlet / Store"
    assert lots[1]["code"].startswith("L") and lots[1]["code"].endswith("-0002")

    # A transfer takes the earliest expiry; it carries on as a lot in the other area.
    store = lots[0]["storage_id"]
    other = client.post("/api/storages", json={"outlet_id": client.get("/api/outlets").json()[0]["id"], "name": "Chiller A"}).json()
    other_id = next(s["id"] for o in other for s in o["storages"] if s["name"] == "Chiller A")
    moved = client.post(
        "/api/transfers",
        json={"from_storage_id": store, "to_storage_id": other_id, "lines": [{"product_id": milk, "quantity": 6}]},
    )
    assert moved.status_code == 201, moved.text
    lots = _lots(client, milk)
    assert sorted((lot["location"], lot["expiry_on"] or "", lot["left"]) for lot in lots) == sorted([
        ("Main outlet / Store", "", 5),
        ("Main outlet / Store", _day(10), 4),
        ("Main outlet / Store", _day(20), 4),
        ("Main outlet / Chiller A", _day(10), 6),
    ])

    # The date filled in later is already past: everyone is told once, then it is disposed of.
    undated = next(lot for lot in lots if lot["expiry_on"] is None)
    resp = client.put(f"/api/lots/{undated['id']}/expiry", json={"expiry_on": _day(-1)})
    assert resp.status_code == 200 and resp.json()["status"] == "expired"
    _lots(client, milk)
    _lots(client, milk)
    alerts = [n for n in client.get("/api/inbox").json()["items"] if n["kind"] == "expiry"]
    assert len(alerts) == 1 and "Expired: Milk" in alerts[0]["body"]

    too_much = client.post(f"/api/lots/{undated['id']}/dispose", json={"quantity": 6, "method": "food_waste"})
    assert too_much.status_code == 409
    done = client.post(f"/api/lots/{undated['id']}/dispose", json={"quantity": 5, "method": "food_waste"})
    assert done.status_code == 201, done.text
    assert done.json()["quantity"] == 5 and done.json()["location"] == "Main outlet / Store"
    assert all(lot["id"] != undated["id"] for lot in _lots(client, milk))
    assert client.get("/api/disposals").json()[0]["method"] == "food_waste"
