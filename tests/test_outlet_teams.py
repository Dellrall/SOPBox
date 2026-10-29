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
