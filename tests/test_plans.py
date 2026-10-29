"""Plans: Free is one outlet without API keys or HQ links; Pro and add-ons are set by the team."""

from datetime import date, timedelta

import psycopg
from fastapi.testclient import TestClient

from app import set_plan
from app.main import app


def _free(_database, client):
    ws = client.get("/api/auth/me").json()["workspace"]["id"]
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("UPDATE workspaces SET plan = 'free', pre_alpha = FALSE WHERE id = %s", (ws,))
    return ws


def test_free_is_one_outlet_without_api_keys_or_hq_links(client, catalogue_ids, _database):
    ws = _free(_database, client)
    plan = client.get("/api/plan").json()
    assert (plan["label"], plan["outlets_allowed"], plan["api_access"]) == ("Free", 1, False)
    store = client.get("/api/outlets").json()[0]["storages"][0]["id"]  # the free outlet
    assert client.post("/api/storages", json={"outlet_id": client.get("/api/outlets").json()[0]["id"], "name": "Substore"}).status_code == 201

    refused = client.post("/api/outlets", json={"name": "Outlet KL"})
    assert refused.status_code == 403 and "Plan & billing" in refused.json()["detail"]
    assert client.post("/api/api-keys", json={"name": "Till", "storage_id": store}).status_code == 403
    assert client.post("/api/workspace/link-codes").status_code == 403

    assert set_plan.main([str(ws), "pro", "--billing", "annual", "--until", str(date.today() + timedelta(days=365)), "--outlets", "1"]) == 0
    assert client.post("/api/outlets", json={"name": "Outlet KL"}).status_code == 201
    assert client.post("/api/outlets", json={"name": "Outlet JB"}).status_code == 403  # 1 free + 1 paid
    assert client.post("/api/api-keys", json={"name": "Till", "storage_id": store}).status_code == 201

    # An annual plan that ran out counts as Free; what was set up stays.
    assert set_plan.main([str(ws), "pro", "--billing", "annual", "--until", str(date.today() - timedelta(days=1))]) == 0
    plan = client.get("/api/plan").json()
    assert plan["plan"] == "free" and plan["lapsed"] is True and plan["outlets_used"] == 2
    assert len(client.get("/api/outlets").json()) == 2


def test_pre_alpha_workspaces_are_marked(client, _database):
    ws = client.get("/api/auth/me").json()["workspace"]["id"]
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("UPDATE workspaces SET pre_alpha = TRUE WHERE id = %s", (ws,))
    assert client.get("/api/plan").json()["pre_alpha"] is True


def test_enquiries_upgrades_and_support_are_saved(client, _database):
    pricing = TestClient(app).get("/api/pricing").json()
    assert pricing["currency"] == "RM" and "pro_outlet_year" in pricing["prices"]

    visitor = TestClient(app)
    lead = {"name": "Ana", "company": "Big Chain", "email": "ANA@example.com", "outlets": 40, "message": "call me"}
    assert visitor.post("/api/inquiries", json=lead).status_code == 201
    for _ in range(4):
        visitor.post("/api/inquiries", json=lead)
    assert visitor.post("/api/inquiries", json=lead).status_code == 429

    up = client.post("/api/plan/upgrade-request", json={"billing": "lifetime", "outlets": 3, "customization": True})
    assert up.status_code == 201
    _free(_database, client)
    assert client.post("/api/support", json={"message": "help"}).json()["priority"] is False
    with psycopg.connect(_database, autocommit=True) as conn:
        rows = conn.execute("SELECT kind, email, message FROM inquiries ORDER BY id").fetchall()
    assert [r[0] for r in rows] == ["sales"] * 5 + ["upgrade", "support"]
    assert rows[0][1] == "ana@example.com" and "Pro, lifetime; 3 outlet(s); customization" in rows[5][2]
