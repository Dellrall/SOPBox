"""Two-step sign-in: authenticator codes at sign-in and before dangerous actions, owner alerts."""

import time

from fastapi.testclient import TestClient

from app import mfa
from app.main import app
from conftest import PASSWORD, sign_up


def _code(secret, offset=0):
    return mfa._code_at(secret, int(time.time() // mfa.STEP_SECONDS) + offset)


def _turn_on(client):
    secret = client.post("/api/auth/mfa/setup").json()["secret"]
    on = client.post("/api/auth/mfa/enable", json={"code": _code(secret)})
    assert on.status_code == 200, on.text
    return secret, on.json()["backup_codes"]


def _login(username="olive"):
    c = TestClient(app)
    resp = c.post("/api/auth/login", json={"username": username, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return c, resp.json()


def test_totp_matches_the_rfc_6238_example():
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  # "12345678901234567890"
    assert mfa._code_at(secret, 59 // 30) == "287082"
    assert mfa.matching_step(secret, "287082", 0, now=59) == 1
    assert mfa.matching_step(secret, "287082", 1, now=59) is None  # used once already


def test_sign_in_waits_for_a_code_and_a_backup_code_works_once(client):
    secret, backups = _turn_on(client)
    assert len(backups) == 10

    c, me = _login()
    assert me["mfa_pending"] is True
    assert c.get("/api/products").status_code == 428
    assert c.get("/api/auth/session").json()["mfa_pending"] is True
    assert c.post("/api/auth/mfa/verify", json={"code": "000000"}).status_code == 422
    done = c.post("/api/auth/mfa/verify", json={"code": backups[0]})
    assert done.status_code == 200 and done.json()["mfa_pending"] is False
    assert c.get("/api/products").status_code == 200

    again, _ = _login()
    assert again.post("/api/auth/mfa/verify", json={"code": backups[0]}).status_code == 422
    assert again.post("/api/auth/mfa/verify", json={"code": _code(secret, 1)}).status_code == 200


def test_five_wrong_codes_lock_the_check(client):
    _turn_on(client)
    c, _ = _login()
    for _ in range(5):
        c.post("/api/auth/mfa/verify", json={"code": "000000"})
    assert c.post("/api/auth/mfa/verify", json={"code": "000000"}).status_code == 429


def test_a_dangerous_action_needs_a_recent_code_and_tells_the_owner(client, make_user, _database):
    import psycopg

    manager = make_user("manager")
    secret, _ = _turn_on(manager)
    with psycopg.connect(_database, autocommit=True) as conn:  # the code from setup has gone stale
        conn.execute("UPDATE sessions SET mfa_at = now() - interval '11 minutes'")
    store = client.get("/api/outlets").json()[0]["storages"][0]["id"]

    refused = manager.post("/api/api-keys", json={"name": "Till", "storage_id": store})
    assert refused.status_code == 428
    assert manager.post("/api/auth/mfa/verify", json={"code": _code(secret)}).status_code == 422  # used at setup
    assert manager.post("/api/auth/mfa/verify", json={"code": _code(secret, 1)}).status_code == 200
    assert manager.post("/api/api-keys", json={"name": "Till", "storage_id": store}).status_code == 201

    alerts = [n for n in client.get("/api/inbox").json()["items"] if n["kind"] == "security"]
    assert [a["body"] for a in alerts] == [f"{manager.get('/api/auth/me').json()['display_name']} made an API key for the till"]
    # A failed action is not announced.
    assert manager.post("/api/api-keys", json={"name": "Till", "storage_id": 999999}).status_code == 422
    assert len([n for n in client.get("/api/inbox").json()["items"] if n["kind"] == "security"]) == 1


def test_the_owner_can_require_it_and_pick_who_gets_alerts(client, make_user):
    manager, staff = make_user("manager"), make_user("staff")
    _turn_on(client)
    assert client.patch("/api/workspace", json={"mfa_policy": "managers"}).status_code == 200

    me = manager.get("/api/auth/me").json()
    assert me["mfa_setup_needed"] is True
    blocked = manager.post("/api/outlets/1", json={})  # any route still works...
    assert blocked.status_code in (404, 405, 422)
    refused = manager.delete("/api/storages/1")  # ...but a dangerous one waits for setup
    assert refused.status_code == 403 and "two-step" in refused.json()["detail"]
    assert staff.get("/api/auth/me").json()["mfa_setup_needed"] is False
    assert client.delete("/api/auth/mfa").status_code == 409  # the owner must keep it on too

    staff_id = staff.get("/api/auth/me").json()["id"]
    assert client.patch(f"/api/users/{staff_id}", json={"security_alerts": True}).json()["security_alerts"] is True
    _turn_on(manager)
    store = client.get("/api/outlets").json()[0]["storages"][0]["id"]
    assert manager.post("/api/api-keys", json={"name": "Till", "storage_id": store}).status_code == 201
    bodies = [n["body"] for n in staff.get("/api/inbox").json()["items"] if n["kind"] == "security"]
    assert len(bodies) == 2 and bodies[0].endswith("made an API key for the till")


def test_a_passkey_sign_in_does_not_wait_for_a_code(client):
    _turn_on(client)
    assert sign_up(workspace="Other", username="otto").get("/api/products").status_code == 200


def test_till_api_keys_are_rate_limited(client):
    store = client.get("/api/outlets").json()[0]["storages"][0]["id"]
    key = client.post("/api/api-keys", json={"name": "Till", "storage_id": store}).json()["key"]
    till = TestClient(app, headers={"Authorization": f"Bearer {key}"})
    for _ in range(60):
        till.get("/api/v1/stock")
    assert till.get("/api/v1/stock").status_code == 429
