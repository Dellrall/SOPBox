"""Closing a business: read-only for 30 days, the owner can reopen it, then it is deleted for good.
And SOPBox support handing a workspace to a new owner (ops.py)."""

from contextlib import contextmanager

import psycopg
from fastapi.testclient import TestClient

from app import closing
from app.db import get_db
from app.main import app
from test_apikeys import _key, _till
from test_locations import _storages

TOKEN = "t" * 40


def _ws(client):
    return client.get("/api/auth/me").json()["workspace"]["id"]


def _close(client):
    resp = client.post("/api/workspace/close", json={"workspace_name": "Test Kitchen"})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_a_closed_business_is_read_only_until_the_owner_reopens_it(client, make_user):
    staff = make_user("staff")
    wrong = client.post("/api/workspace/close", json={"workspace_name": "Test kitchen?"})
    assert wrong.status_code == 422
    closed = _close(client)
    assert closed["closed_at"] and closed["delete_on"]
    assert client.get("/api/auth/me").json()["closing"]["delete_on"] == closed["delete_on"]
    assert "closed Test Kitchen" in staff.get("/api/inbox").json()["items"][0]["body"]

    refused = client.post("/api/categories", json={"name": "Dairy"})
    assert refused.status_code == 403 and "closed" in refused.json()["detail"]
    assert client.get("/api/categories").status_code == 200
    assert client.get("/api/export").status_code == 200  # a copy can still be taken
    assert client.post("/api/workspace/close", json={"workspace_name": "Test Kitchen"}).status_code == 403  # already read-only

    assert client.post("/api/workspace/reopen").status_code == 200
    assert client.get("/api/auth/me").json()["closing"]["closed_at"] is None
    assert client.post("/api/categories", json={"name": "Dairy"}).status_code == 201
    actions = [e["action"] for e in client.get("/api/audit").json()]
    assert "workspace.closed" in actions and "workspace.reopened" in actions


def test_only_the_owner_closes_and_a_till_cannot_record_sales_while_closed(client, make_user):
    manager = make_user("manager")
    assert manager.post("/api/workspace/close", json={"workspace_name": "Test Kitchen"}).status_code == 403
    till = _till(_key(client, _storages(client)["Main outlet / Store"])["key"])
    _close(client)
    sent = till.post("/api/v1/sales", json={"sale_date": "2026-10-29", "reference": "R-1", "lines": [{"code": "1", "quantity": 1}]})
    assert sent.status_code == 403
    assert till.get("/api/v1/stock").status_code == 200


def test_after_the_grace_period_everything_is_deleted_and_a_note_kept(_database, client):
    ws = _ws(client)
    _close(client)
    with contextmanager(get_db)() as conn:
        assert closing.delete_due(conn) == 0  # still in the grace period
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("UPDATE workspaces SET closing_at = now() - interval '31 days' WHERE id = %s", (ws,))
    with contextmanager(get_db)() as conn:  # as the app, under row-level security
        assert closing.delete_due(conn) == 1
    with psycopg.connect(_database, autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM users WHERE workspace_id = %s", (ws,)).fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM audit_log WHERE workspace_id = %s", (ws,)).fetchone()[0] == 0
        assert conn.execute("SELECT name, closed_by FROM closed_workspaces WHERE id = %s", (ws,)).fetchone() == ("Test Kitchen", "olive")
    assert client.get("/api/auth/me").status_code == 401


def _ops(monkeypatch, token=TOKEN):
    monkeypatch.setenv("OPS_TOKEN", TOKEN)
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


def test_support_routes_need_the_token_and_do_not_exist_without_it(client, monkeypatch):
    ws = _ws(client)
    assert TestClient(app).get(f"/api/ops/workspaces/{ws}").status_code == 404
    assert _ops(monkeypatch, token="wrong").get(f"/api/ops/workspaces/{ws}").status_code == 401
    assert client.get(f"/api/ops/workspaces/{ws}").status_code == 401  # signing in is not enough
    members = _ops(monkeypatch).get(f"/api/ops/workspaces/{ws}").json()["members"]
    assert [(m["username"], m["role"]) for m in members] == [("olive", "owner")]


def test_support_hands_the_workspace_to_a_manager(client, make_user, monkeypatch):
    ws = _ws(client)
    manager = make_user("manager", "mia")
    ops = _ops(monkeypatch)
    assert ops.post(f"/api/ops/workspaces/{ws}/owner", json={"username": "nobody", "reason": "sold"}).status_code == 404
    moved = ops.post(f"/api/ops/workspaces/{ws}/owner", json={"username": "MIA", "reason": "Olive sold the business"})
    assert moved.status_code == 200, moved.text
    assert {m["username"]: m["role"] for m in moved.json()["members"]} == {"mia": "owner", "olive": "manager"}
    assert manager.get("/api/auth/me").json()["role"] == "owner"
    assert client.get("/api/users").status_code == 403  # Olive is a manager now
    assert "made Mia the owner" in client.get("/api/inbox").json()["items"][0]["body"]
    entry = next(e for e in manager.get("/api/audit").json() if e["action"] == "owner.transferred")
    assert entry["actor"] == "SOPBox support" and "Olive sold the business" in entry["detail"]


def test_support_can_remove_an_owner_who_cannot_be_reached(client, make_user, monkeypatch):
    ws = _ws(client)
    make_user("staff", "sam")
    moved = _ops(monkeypatch).post(
        f"/api/ops/workspaces/{ws}/owner", json={"username": "sam", "reason": "owner passed away", "old_owner": "remove"}
    )
    olive = next(m for m in moved.json()["members"] if m["username"] == "olive")
    assert olive["active"] is False and olive["role"] == "manager"
    assert client.get("/api/auth/me").status_code == 401  # signed out everywhere
