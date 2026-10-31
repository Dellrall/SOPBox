"""Task lists: managers write them, each role sees its own, and ticks belong to one day."""

from datetime import datetime, timedelta, timezone

from conftest import sign_up

TODAY = datetime.now(timezone.utc).date()
OPENING = {"name": "Opening", "kind": "daily", "for_role": "staff", "steps": ["Turn on fryers", "Check chiller temps"]}
CASH = {"name": "Cash up", "kind": "daily", "for_role": "manager", "steps": ["Count the till"]}


def _tasks(c, day=TODAY):
    resp = c.get("/api/tasks", params={"day": day.isoformat()})
    assert resp.status_code == 200, resp.text
    return {t["name"]: t for t in resp.json()}


def test_staff_see_their_lists_and_tick_steps_for_today(client, make_user):
    opening = client.post("/api/tasks", json=OPENING).json()
    client.post("/api/tasks", json=CASH)
    staff = make_user("staff", name="Sam Staff")
    assert set(_tasks(staff)) == {"Opening"}
    assert set(_tasks(client)) == {"Opening", "Cash up"}

    ticked = staff.post(f"/api/tasks/{opening['id']}/ticks", json={"day": TODAY.isoformat(), "step": 1, "done": True})
    assert ticked.status_code == 200, ticked.text
    assert [(t["step"], t["done_by"]) for t in ticked.json()["ticks"]] == [(1, "Sam Staff")]
    # A new day starts fresh; unticking removes it.
    assert _tasks(staff, TODAY + timedelta(days=1))["Opening"]["ticks"] == []
    staff.post(f"/api/tasks/{opening['id']}/ticks", json={"day": TODAY.isoformat(), "step": 1, "done": False})
    assert _tasks(staff)["Opening"]["ticks"] == []


def test_only_managers_edit_lists_and_staff_cannot_tick_a_manager_list(client, make_user):
    cash = client.post("/api/tasks", json=CASH).json()
    staff = make_user("staff")
    assert staff.post("/api/tasks", json=OPENING).status_code == 403
    assert staff.delete(f"/api/tasks/{cash['id']}").status_code == 403
    tick = {"day": TODAY.isoformat(), "step": 0, "done": True}
    assert staff.post(f"/api/tasks/{cash['id']}/ticks", json=tick).status_code == 404


def test_ticks_are_refused_for_a_far_day_or_a_missing_step(client):
    opening = client.post("/api/tasks", json=OPENING).json()
    far = {"day": (TODAY - timedelta(days=3)).isoformat(), "step": 0, "done": True}
    assert client.post(f"/api/tasks/{opening['id']}/ticks", json=far).status_code == 422
    missing = {"day": TODAY.isoformat(), "step": 5, "done": True}
    assert client.post(f"/api/tasks/{opening['id']}/ticks", json=missing).status_code == 422


def test_names_are_unique_and_shortening_a_list_drops_its_old_ticks(client):
    opening = client.post("/api/tasks", json=OPENING).json()
    dup = client.post("/api/tasks", json={**OPENING, "name": "OPENING"})
    assert dup.status_code == 409
    client.post(f"/api/tasks/{opening['id']}/ticks", json={"day": TODAY.isoformat(), "step": 1, "done": True})
    short = client.put(f"/api/tasks/{opening['id']}", json={**OPENING, "steps": ["Turn on fryers"]})
    assert short.status_code == 200
    assert short.json()["ticks"] == []
    assert client.delete(f"/api/tasks/{opening['id']}").status_code == 204
    assert _tasks(client) == {}


def test_another_workspace_cannot_see_or_tick_the_lists(client):
    opening = client.post("/api/tasks", json=OPENING).json()
    other = sign_up(workspace="Other Cafe", username="otto")
    assert _tasks(other) == {}
    tick = {"day": TODAY.isoformat(), "step": 0, "done": True}
    assert other.post(f"/api/tasks/{opening['id']}/ticks", json=tick).status_code == 404
    assert other.put(f"/api/tasks/{opening['id']}", json=OPENING).status_code == 404


def test_each_outlet_has_its_own_opening_list(client):
    home = client.get("/api/outlets").json()[0]["id"]
    kl = client.post("/api/outlets", json={"name": "Outlet KL"}).json()[-1]["id"]
    at_home, at_kl = {"X-SOPBox-Outlet": str(home)}, {"X-SOPBox-Outlet": str(kl)}
    first = client.post("/api/tasks", json=OPENING, headers=at_home)
    assert first.status_code == 201, first.text
    second = client.post("/api/tasks", json=OPENING, headers=at_kl)
    assert second.status_code == 201, second.text
    assert client.post("/api/tasks", json=OPENING, headers=at_kl).status_code == 409  # same outlet, same name
    # Ticks stay with each outlet's own list.
    client.post(f"/api/tasks/{first.json()['id']}/ticks", json={"day": TODAY.isoformat(), "step": 0, "done": True}, headers=at_home)
    kl_lists = client.get("/api/tasks", params={"day": TODAY.isoformat()}, headers=at_kl).json()
    assert [(t["id"], t["ticks"]) for t in kl_lists] == [(second.json()["id"], [])]
