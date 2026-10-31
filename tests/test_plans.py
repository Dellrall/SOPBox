"""Plans: Free is one outlet without API keys or HQ links; Pro and add-ons are set by the team."""

from datetime import date, timedelta

import psycopg
from fastapi.testclient import TestClient

from app import plan_codes, set_plan
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


def test_a_visitor_asks_a_question_from_the_contact_page(_database, anon):
    question = {"topic": "question", "name": "Ben", "email": "ben@example.com", "message": ""}
    assert anon.post("/api/inquiries", json=question).status_code == 422  # a question needs one
    assert anon.post("/api/inquiries", json={**question, "message": "Does it work offline?"}).status_code == 201
    with psycopg.connect(_database, autocommit=True) as conn:
        assert conn.execute("SELECT kind FROM inquiries").fetchall() == [("question",)]


def _code(capsys, *args: str) -> str:
    assert plan_codes.main(list(args)) == 0
    return capsys.readouterr().out.strip()


def test_a_code_from_the_team_turns_pro_on_once_per_workspace(client, _database, capsys):
    _free(_database, client)
    code = _code(capsys, "--outlets", "2", "--days", "30", "--uses", "2")
    assert code.startswith("PRO-") and len(code) == 23

    assert client.post("/api/plan/redeem", json={"code": "PRO-NOPE-NOPE-NOPE-NOPE"}).status_code == 422
    typed = code.lower().replace("-", " ")  # case, spaces and dashes do not matter
    plan = client.post("/api/plan/redeem", json={"code": typed}).json()
    assert (plan["plan"], plan["billing"], plan["outlets_allowed"]) == ("pro", "annual", 3)
    assert plan["until"] == str(date.today() + timedelta(days=30))
    assert client.post("/api/outlets", json={"name": "Outlet KL"}).status_code == 201

    # Not twice in one workspace, and a second yearly code adds its days to what is left.
    assert client.post("/api/plan/redeem", json={"code": code}).status_code == 422
    more = _code(capsys, "--outlets", "1", "--days", "10")
    plan = client.post("/api/plan/redeem", json={"code": more}).json()
    assert plan["until"] == str(date.today() + timedelta(days=40)) and plan["outlets_allowed"] == 3  # never fewer outlets

    with psycopg.connect(_database) as conn:
        assert conn.execute("SELECT count(*) FROM plan_codes WHERE uses_left = 0").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM audit_log WHERE action = 'plan.code_redeemed'").fetchone()[0] == 2


def test_only_owners_redeem_and_expired_codes_do_not_work(client, make_user, _database, capsys):
    _free(_database, client)
    old = _code(capsys, "--outlets", "1", "--lifetime", "--expires", str(date.today() - timedelta(days=1)))
    assert client.post("/api/plan/redeem", json={"code": old}).status_code == 422
    code = _code(capsys, "--outlets", "1", "--lifetime")
    assert make_user("manager").post("/api/plan/redeem", json={"code": code}).status_code == 403
    plan = client.post("/api/plan/redeem", json={"code": code}).json()
    assert (plan["billing"], plan["until"]) == ("lifetime", None)
    yearly = _code(capsys, "--outlets", "5", "--days", "30")
    assert client.post("/api/plan/redeem", json={"code": yearly}).status_code == 409  # would cut life to a year


def test_free_holds_up_to_fifty_products(client, catalogue_ids, _database):
    _free(_database, client)
    category = catalogue_ids["packaging_category"]
    for i in range(48):  # the catalogue already has 2
        assert client.post("/api/products", json={"name": f"Item {i}", "category_id": category, "base_unit": "pcs"}).status_code == 201
    refused = client.post("/api/products", json={"name": "One too many", "category_id": category, "base_unit": "pcs"})
    assert refused.status_code == 403 and "up to 50 products" in refused.json()["detail"]
    # Archiving one makes room; bringing it back once the room is used is refused too.
    first = catalogue_ids["fries"]
    assert client.patch(f"/api/products/{first}", json={"archived": True}).status_code == 200
    assert client.post("/api/products", json={"name": "Replacement", "category_id": category, "base_unit": "pcs"}).status_code == 201
    back = client.patch(f"/api/products/{first}", json={"archived": False})
    assert back.status_code == 403 and "up to 50 products" in back.json()["detail"]
    assert client.get("/api/pricing").json()["prices"]["free_products"] == 50


def test_pro_bills_only_outlets_with_work_this_month(client, catalogue_ids):
    from app import plans

    assert plans.monthly_bill_sen(0) == 0  # a quiet month costs nothing
    assert plans.monthly_bill_sen(1) == 4900
    assert plans.monthly_bill_sen(3) == 4900 + 2 * 2900
    before = client.get("/api/plan").json()["active_outlets"]
    client.post(
        "/api/deliveries",
        json={"supplier": "S", "lines": [{"product_id": catalogue_ids["fries"], "name": "Fries", "quantity": 1, "unit": "pcs"}]},
    )
    assert client.get("/api/plan").json()["active_outlets"] == max(before, 1)


def test_ai_has_a_monthly_allowance_and_free_reads_sales_a_few_times(client, catalogue_ids, _database, monkeypatch):
    from app import main, sales_ai

    ws = _free(_database, client)
    monkeypatch.setattr(main, "extract_lines", lambda image: [])
    assert client.post("/api/extract", json={"image_b64": "aW1n"}).status_code == 200
    plan = client.get("/api/plan").json()
    assert (plan["ai_used"], plan["ai_allowed"]) == (1, 30)

    # Sales: 10 a month on Free, within the 30.
    monkeypatch.setattr(sales_ai, "available", lambda: True)
    monkeypatch.setattr(sales_ai, "_chat", lambda content, system, max_tokens=8000: {"items": [{"name": "Tea", "quantity": 1}]})
    store = client.get("/api/outlets").json()[0]["storages"][0]["id"]
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("INSERT INTO ai_uses (workspace_id, feature) SELECT %s, 'sales' FROM generate_series(1, 10)", (ws,))
    sales = client.post("/api/sales/read", json={"storage_id": store, "text": "Tea 1"})
    assert sales.status_code == 403 and "10 times a month" in sales.json()["detail"]

    # The whole allowance used up: refused, and a failed call is never counted.
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("INSERT INTO ai_uses (workspace_id, feature) SELECT %s, 'delivery' FROM generate_series(1, 19)", (ws,))
    refused = client.post("/api/extract", json={"image_b64": "aW1n"})
    assert refused.status_code == 403 and "30 AI uses are used up" in refused.json()["detail"]
    assert client.get("/api/plan").json()["ai_used"] == 30
    # Last month's uses do not count.
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("UPDATE ai_uses SET at = now() - interval '40 days' WHERE workspace_id = %s", (ws,))
    assert client.post("/api/extract", json={"image_b64": "aW1n"}).status_code == 200
