"""Each person can work at one outlet; that outlet's managers add and look after its staff, and the
outlet manager makes assistant managers, who hire but cannot disable anyone."""

import psycopg

from tests.conftest import PASSWORD, sign_in


def _pro(_database, client):
    ws = client.get("/api/auth/me").json()["workspace"]["id"]
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("UPDATE workspaces SET plan = 'enterprise' WHERE id = %s", (ws,))


def _person(client, username, role, outlet_id):
    body = {"username": username, "display_name": username.title(), "role": role, "password": PASSWORD, "outlet_id": outlet_id}
    resp = client.post("/api/users", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_an_outlet_manager_looks_after_only_their_outlets_staff(client, _database):
    _pro(_database, client)
    home = client.get("/api/outlets").json()[0]["id"]
    kl = client.post("/api/outlets", json={"name": "Outlet KL"}).json()[-1]["id"]
    _person(client, "kate", "manager", kl)
    _person(client, "hana", "staff", home)
    kate = sign_in("kate")
    assert kate.get("/api/auth/me").json()["outlet_id"] == kl

    # Kate adds staff: always to her outlet, never managers.
    made = kate.post("/api/users", json={"username": "kim", "display_name": "Kim", "role": "staff", "password": PASSWORD, "outlet_id": home})
    assert made.status_code == 201 and made.json()["outlet_id"] == kl
    assert kate.post("/api/users", json={"username": "max", "display_name": "Max", "role": "manager", "password": PASSWORD}).status_code == 403
    assert {u["username"] for u in kate.get("/api/users").json()} == {"kate", "kim"}

    kim, hana = made.json()["id"], next(u for u in client.get("/api/users").json() if u["username"] == "hana")["id"]
    assert kate.patch(f"/api/users/{kim}", json={"display_name": "Kim Lee", "active": False}).status_code == 200
    assert kate.patch(f"/api/users/{kim}", json={"role": "manager", "assistant": False}).status_code == 403
    assert kate.patch(f"/api/users/{kim}", json={"outlet_id": home}).status_code == 403
    assert kate.patch(f"/api/users/{hana}", json={"active": False}).status_code == 403  # another outlet

    # The owner moves people between outlets, or unties them.
    assert client.patch(f"/api/users/{kim}", json={"outlet_id": home}).json()["outlet_id"] == home
    assert client.patch(f"/api/users/{kim}", json={"outlet_id": None}).json()["outlet_id"] is None


def test_a_manager_without_an_outlet_manages_nobody_and_outlets_stay_in_the_workspace(client, _database, make_user):
    _pro(_database, client)
    manager = make_user("manager")
    assert manager.get("/api/users").status_code == 403
    stranger = client.post("/api/users", json={"username": "zed", "display_name": "Zed", "role": "staff", "password": PASSWORD, "outlet_id": 999999})
    assert stranger.status_code == 422


def test_the_outlet_manager_makes_assistant_managers_who_hire_but_do_not_fire(client, _database):
    _pro(_database, client)
    kl = client.post("/api/outlets", json={"name": "Outlet KL"}).json()[-1]["id"]
    _person(client, "kate", "manager", kl)
    kate = sign_in("kate")
    assert kate.get("/api/auth/me").json()["assistant"] is False

    # Kate hires an assistant manager, and promotes a staff member to one.
    body = {"username": "amy", "display_name": "Amy", "role": "manager", "assistant": True, "password": PASSWORD}
    amy = kate.post("/api/users", json=body).json()
    assert (amy["role"], amy["assistant"], amy["outlet_id"]) == ("manager", True, kl)
    kim = kate.post("/api/users", json={"username": "kim", "display_name": "Kim", "role": "staff", "password": PASSWORD}).json()
    promoted = kate.patch(f"/api/users/{kim['id']}", json={"role": "manager"}).json()
    assert (promoted["role"], promoted["assistant"]) == ("manager", True)
    assert kate.patch(f"/api/users/{kim['id']}", json={"role": "staff"}).json()["assistant"] is False

    # Amy hires staff and looks after them, but disables nobody and promotes nobody.
    assistant = sign_in("amy")
    assert assistant.get("/api/auth/me").json()["assistant"] is True
    sam = assistant.post("/api/users", json={"username": "sam", "display_name": "Sam", "role": "staff", "password": PASSWORD})
    assert sam.status_code == 201 and sam.json()["outlet_id"] == kl
    sam = sam.json()["id"]
    assert assistant.post("/api/users", json={**body, "username": "ann"}).status_code == 403
    assert assistant.patch(f"/api/users/{sam}", json={"display_name": "Sam Tan"}).status_code == 200
    assert assistant.patch(f"/api/users/{sam}", json={"active": False}).status_code == 403
    assert assistant.patch(f"/api/users/{sam}", json={"role": "manager"}).status_code == 403
    assert assistant.patch(f"/api/users/{kim['id']}", json={"active": False}).status_code == 403
    assert kate.patch(f"/api/users/{amy['id']}", json={"active": False}).status_code == 200

    # Only the owner makes a full manager; staff are never assistants.
    assert kate.patch(f"/api/users/{amy['id']}", json={"assistant": False}).status_code == 403
    assert client.patch(f"/api/users/{amy['id']}", json={"assistant": False}).json()["assistant"] is False
    staff = {"username": "zoe", "display_name": "Zoe", "role": "staff", "assistant": True, "password": PASSWORD}
    assert client.post("/api/users", json=staff).status_code == 422


def test_someone_tied_to_an_outlet_sees_and_uses_only_its_storage_areas(client, _database, catalogue_ids):
    _pro(_database, client)
    home = client.get("/api/outlets").json()[0]
    kl = client.post("/api/outlets", json={"name": "Outlet KL"}).json()[-1]
    home_store, kl_store = home["storages"][0]["id"], kl["storages"][0]["id"]
    _person(client, "kim", "staff", kl["id"])
    kim = sign_in("kim")
    assert [o["id"] for o in kim.get("/api/outlets").json()] == [kl["id"]]
    assert [o["id"] for o in client.get("/api/outlets").json()] == sorted([home["id"], kl["id"]], key=lambda i: i != home["id"])
    # The owner counts at both outlets; Kim sees only her outlet's count, and cannot count elsewhere.
    for store in (home_store, kl_store):
        made = client.post("/api/stocktakes", json={"storage_id": store, "count_date": "2026-10-31", "lines": [
            {"product_id": catalogue_ids["fries"], "expected_stock": 0, "counted_stock": 0}]})
        assert made.status_code == 201, made.text
    client.patch(f"/api/users/{kim.get('/api/auth/me').json()['id']}", json={"section_access": {"stocktake": "edit"}})
    assert [s["storage"] for s in kim.get("/api/stocktakes").json()] == ["Outlet KL / Store"]
    assert kim.get(f"/api/storages/{home_store}/stock").status_code == 403
    assert kim.get(f"/api/storages/{kl_store}/stock").status_code == 200
    other = kim.post("/api/stocktakes", json={"storage_id": home_store, "count_date": "2026-10-31", "lines": [
        {"product_id": catalogue_ids["fries"], "expected_stock": 0, "counted_stock": 0}]})
    assert other.status_code == 403


def test_picking_an_outlet_shows_only_its_orders_counts_deliveries_tasks_and_activity(client, _database, catalogue_ids):
    """The owner works in one outlet at a time, or in all of them; what each outlet has stays apart."""
    _pro(_database, client)
    home = client.get("/api/outlets").json()[0]
    kl = client.post("/api/outlets", json={"name": "Outlet KL"}).json()[-1]
    at = {o["id"]: {"X-SOPBox-Outlet": str(o["id"])} for o in (home, kl)}
    supplier = client.post("/api/suppliers", json={"name": "Fresh Mart"}).json()["id"]
    line = {"product_id": catalogue_ids["fries"], "quantity": 2, "unit": "bdl"}
    for outlet in (home, kl):
        h = at[outlet["id"]]
        made = client.post("/api/purchase-orders", headers=h, json={"supplier_id": supplier, "order_date": "2026-10-31", "lines": [line]})
        assert made.status_code == 201, made.text
        assert client.post("/api/tasks", headers=h, json={"name": f"Open {outlet['name']}", "kind": "daily", "for_role": "staff", "steps": ["Lights on"]}).status_code == 201
        count = client.post("/api/stocktakes", headers=h, json={"count_date": "2026-10-31", "lines": [
            {"product_id": catalogue_ids["fries"], "expected_stock": 0, "counted_stock": 0}]})
        assert count.status_code == 201, count.text
        assert client.post("/api/deliveries", headers=h, json={"supplier": f"For {outlet['name']}", "lines": [
            {"product_id": catalogue_ids["fries"], "name": "Fries tray", "quantity": 1, "unit": "bdl"}]}).status_code == 201

    for outlet, other in ((home, kl), (kl, home)):
        h = at[outlet["id"]]
        assert len(client.get("/api/purchase-orders", headers=h).json()) == 1
        assert [t["name"] for t in client.get("/api/tasks", headers=h, params={"day": "2026-10-31"}).json()] == [f"Open {outlet['name']}"]
        assert {s["storage"].split(" / ")[0] for s in client.get("/api/stocktakes", headers=h).json()} == {outlet["name"]}
        assert [d["supplier"] for d in client.get("/api/deliveries", headers=h).json()] == [f"For {outlet['name']}"]
        entries = client.get("/api/audit", headers=h).json()
        details = " ".join(a["detail"] for a in entries)
        assert f"For {other['name']}" not in details and f"Open {other['name']}" not in details
        assert "outlet.created" in [a["action"] for a in entries]  # about the whole workspace: every outlet sees it
        board = client.get("/api/dashboard", headers=h).json()
        assert board["delivery_count"] == 1 and [d["supplier"] for d in board["recent_deliveries"]] == [f"For {outlet['name']}"]
        assert len(board["recent_activity"]) == 1

    # Low stock is per outlet when one is picked: sausage (minimum 50) is stocked at home only.
    stocked = client.post("/api/stocktakes", headers=at[home["id"]], json={"count_date": "2026-10-31", "lines": [
        {"product_id": catalogue_ids["sausage"], "expected_stock": 0, "counted_stock": 60}]})
    assert stocked.status_code == 201, stocked.text
    low = lambda h: [p["id"] for p in client.get("/api/dashboard", headers=h).json()["low_stock_products"]]  # noqa: E731
    assert catalogue_ids["sausage"] not in low(at[home["id"]]) and catalogue_ids["sausage"] in low(at[kl["id"]])
    assert catalogue_ids["sausage"] not in low({})

    # All outlets: everything; an order cannot be added without picking where it is for.
    assert len(client.get("/api/purchase-orders").json()) == 2
    assert len(client.get("/api/deliveries").json()) == 2
    nowhere = client.post("/api/purchase-orders", json={"supplier_id": supplier, "order_date": "2026-10-31", "lines": [line]})
    assert nowhere.status_code == 422 and "pick an outlet" in nowhere.text
