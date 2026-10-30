"""Workspaces, sign-in, and the owner managing their people."""

import pytest

from fastapi.testclient import TestClient

from app.main import app
from conftest import PASSWORD, sign_in, sign_up


def register_body(**overrides):
    body = {
        "workspace_name": "Test Kitchen",
        "display_name": "Olive Owner",
        "username": "olive",
        "password": PASSWORD,
    }
    body = {**body, **overrides}
    body.setdefault("email", f"{body['username'].lower()}@example.com")
    return body


# ---- registering a workspace ------------------------------------------------------------------


def test_registering_creates_a_workspace_and_makes_you_its_owner(anon):
    resp = anon.post("/api/auth/register", json=register_body())
    assert resp.status_code == 201
    assert resp.json()["role"] == "owner"
    assert resp.json()["workspace"]["name"] == "Test Kitchen"
    # Already signed in: the session cookie came with the response.
    assert anon.get("/api/auth/me").json()["username"] == "olive"


def test_a_new_workspace_is_empty(client):
    assert client.get("/api/products").json() == []
    assert client.get("/api/categories").json() == []
    assert client.get("/api/deliveries").json() == []
    assert [u["username"] for u in client.get("/api/users").json()] == ["olive"]


def test_usernames_are_unique_across_workspaces_ignoring_case(client, anon):
    resp = anon.post("/api/auth/register", json=register_body(workspace_name="Other", username="OLIVE"))
    assert resp.status_code == 409


@pytest.mark.parametrize(
    "overrides",
    [
        {"username": "ab"},
        {"username": "has space"},
        {"username": "UPPER!"},
        {"password": "short"},
        {"workspace_name": "  "},
        {"display_name": ""},
        {"email": ""},
        {"email": "not-an-email"},
        {"email": "two@@example.com"},
    ],
)
def test_registration_checks_its_input(anon, overrides):
    assert anon.post("/api/auth/register", json=register_body(**overrides)).status_code == 422


def test_usernames_are_stored_in_lower_case(anon):
    anon.post("/api/auth/register", json=register_body(username="Olive.Owner"))
    assert anon.get("/api/auth/me").json()["username"] == "olive.owner"
    assert sign_in("OLIVE.owner").get("/api/auth/me").status_code == 200


def test_registering_keeps_the_email_in_lower_case_and_you_can_sign_in_with_it(anon):
    anon.post("/api/auth/register", json=register_body(email="Olive@Example.COM"))
    assert anon.get("/api/auth/me").json()["email"] == "olive@example.com"
    assert sign_in("OLIVE@example.com").get("/api/auth/me").json()["username"] == "olive"


def test_an_email_belongs_to_one_account(client, anon):
    resp = anon.post(
        "/api/auth/register",
        json=register_body(workspace_name="Other", username="other", email="olive@example.com"),
    )
    assert resp.status_code == 409
    assert "email" in resp.json()["detail"]


def test_you_can_change_your_own_name_and_email(client):
    resp = client.patch("/api/auth/me", json={"display_name": "Olive O.", "email": "new@example.com"})
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "Olive O."
    assert sign_in("new@example.com").get("/api/auth/me").status_code == 200
    # An empty email removes it.
    assert client.patch("/api/auth/me", json={"email": ""}).json()["email"] is None
    assert client.patch("/api/auth/me", json={"email": "nope"}).status_code == 422


def test_staff_email_is_optional_and_the_owner_can_set_it(client):
    resp = client.post(
        "/api/users",
        json={"username": "sam", "display_name": "Sam", "role": "staff", "password": PASSWORD},
    )
    assert resp.status_code == 201
    assert resp.json()["email"] is None
    user_id = resp.json()["id"]
    resp = client.patch(f"/api/users/{user_id}", json={"email": "Sam@Example.com"})
    assert resp.json()["email"] == "sam@example.com"
    taken = client.patch(f"/api/users/{user_id}", json={"email": "olive@example.com"})
    assert taken.status_code == 409


def test_one_address_cannot_create_unlimited_workspaces(anon):
    for i in range(10):
        assert anon.post("/api/auth/register", json=register_body(username=f"owner{i}")).status_code == 201
    assert anon.post("/api/auth/register", json=register_body(username="owner10")).status_code == 429


# ---- signing in and out -----------------------------------------------------------------------


def test_sign_in_with_the_right_password(client, anon):
    resp = anon.post("/api/auth/login", json={"username": "olive", "password": PASSWORD})
    assert resp.status_code == 200
    assert anon.get("/api/auth/me").json()["display_name"] == "Olive Owner"


@pytest.mark.parametrize("username", ["olive", "nobody"])
def test_a_wrong_password_and_an_unknown_user_look_the_same(client, anon, username):
    resp = anon.post("/api/auth/login", json={"username": username, "password": "wrong password"})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "wrong username, email or password"


def test_five_wrong_passwords_lock_the_account_for_a_while(client, anon):
    for _ in range(5):
        anon.post("/api/auth/login", json={"username": "olive", "password": "wrong password"})
    resp = anon.post("/api/auth/login", json={"username": "olive", "password": PASSWORD})
    assert resp.status_code == 429


def test_signing_out_ends_the_session(client):
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_the_session_cookie_is_http_only_and_secure_by_default(anon, monkeypatch):
    monkeypatch.setenv("COOKIE_SECURE", "1")
    cookie = anon.post("/api/auth/register", json=register_body()).headers["set-cookie"].lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie


def test_the_database_never_holds_a_usable_session_token(client, _database):
    import psycopg

    token = client.cookies["sopbox_session"]
    with psycopg.connect(_database) as conn:
        hashes = [r[0] for r in conn.execute("SELECT token_hash FROM sessions").fetchall()]
    assert token not in hashes and len(hashes) == 1


def test_passwords_are_hashed_and_never_returned(client, _database):
    import psycopg

    with psycopg.connect(_database) as conn:
        stored = conn.execute("SELECT password_hash FROM users").fetchone()[0]
    assert PASSWORD not in stored and stored.startswith("scrypt$")
    assert "password" not in client.get("/api/users").text


# ---- the owner manages people -----------------------------------------------------------------


def test_the_owner_creates_accounts_for_employees(client):
    resp = client.post(
        "/api/users",
        json={"username": "sam", "display_name": "Sam Staff", "role": "staff", "password": PASSWORD},
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "staff" and resp.json()["active"] is True
    assert sign_in("sam").get("/api/auth/me").json()["workspace"]["name"] == "Test Kitchen"


def test_a_second_owner_cannot_be_created(client):
    resp = client.post(
        "/api/users",
        json={"username": "bob", "display_name": "Bob", "role": "owner", "password": PASSWORD},
    )
    assert resp.status_code == 422


def test_a_taken_username_is_a_conflict(client, make_user):
    make_user("staff", "sam")
    resp = client.post(
        "/api/users",
        json={"username": "SAM", "display_name": "Other", "role": "staff", "password": PASSWORD},
    )
    assert resp.status_code == 409


def test_only_the_owner_can_create_accounts(make_user):
    manager = make_user("manager")
    resp = manager.post(
        "/api/users",
        json={"username": "x" * 5, "display_name": "X", "role": "staff", "password": PASSWORD},
    )
    assert resp.status_code == 403


def test_disabling_an_account_signs_the_person_out_and_blocks_sign_in(client, make_user):
    staff = make_user("staff", "sam")
    user_id = next(u["id"] for u in client.get("/api/users").json() if u["username"] == "sam")

    assert client.patch(f"/api/users/{user_id}", json={"active": False}).status_code == 200
    assert staff.get("/api/auth/me").status_code == 401
    anon = TestClient(app)
    assert anon.post("/api/auth/login", json={"username": "sam", "password": PASSWORD}).status_code == 401

    client.patch(f"/api/users/{user_id}", json={"active": True})
    assert sign_in("sam").get("/api/auth/me").status_code == 200


def test_resetting_a_password_signs_the_person_out_everywhere(client, make_user):
    staff = make_user("staff", "sam")
    user_id = next(u["id"] for u in client.get("/api/users").json() if u["username"] == "sam")

    client.patch(f"/api/users/{user_id}", json={"password": "a brand new password"})
    assert staff.get("/api/auth/me").status_code == 401
    assert sign_in("sam", "a brand new password").get("/api/auth/me").status_code == 200


def test_changing_a_role_takes_effect_at_once(client, make_user):
    staff = make_user("staff", "sam")
    user_id = next(u["id"] for u in client.get("/api/users").json() if u["username"] == "sam")
    client.patch(f"/api/users/{user_id}", json={"role": "manager"})
    assert staff.get("/api/auth/me").status_code == 401  # signed out, so the old role is gone
    assert sign_in("sam").get("/api/auth/me").json()["role"] == "manager"


def test_the_owner_account_cannot_be_edited_through_the_people_list(client):
    owner_id = client.get("/api/auth/me").json()["id"]
    assert client.patch(f"/api/users/{owner_id}", json={"active": False}).status_code == 422
    assert client.patch(f"/api/users/{owner_id}", json={"role": "staff"}).status_code == 422


def test_people_can_change_their_own_password(client, make_user):
    staff = make_user("staff", "sam")
    other_device = sign_in("sam")

    wrong = staff.post(
        "/api/auth/password", json={"current_password": "nope nope nope", "new_password": "another new one"}
    )
    assert wrong.status_code == 422
    ok = staff.post(
        "/api/auth/password", json={"current_password": PASSWORD, "new_password": "another new one"}
    )
    assert ok.status_code == 204
    assert staff.get("/api/auth/me").status_code == 200  # this device stays signed in
    assert other_device.get("/api/auth/me").status_code == 401
    assert sign_in("sam", "another new one").get("/api/auth/me").status_code == 200


def test_the_owner_sets_where_telegram_alerts_go(client):
    resp = client.patch(
        "/api/workspace", json={"telegram_manager_chat_id": "-100123", "telegram_staff_chat_id": "@sopbox_team"}
    )
    assert resp.json()["telegram_manager_chat_id"] == "-100123"
    assert client.patch("/api/workspace", json={"telegram_manager_chat_id": "not an id"}).status_code == 422


def test_user_changes_are_in_the_audit_log(client, make_user):
    make_user("staff", "sam")
    actions = [(e["actor"], e["action"]) for e in client.get("/api/audit").json()]
    assert ("Olive Owner", "user.created") in actions


def test_the_log_says_what_changed_and_skips_repeated_clicks(client, make_user):
    make_user("staff", "sam")
    user_id = next(u["id"] for u in client.get("/api/users").json() if u["username"] == "sam")
    client.patch(f"/api/users/{user_id}", json={"active": False})
    client.patch(f"/api/users/{user_id}", json={"active": False})  # already disabled: nothing to log
    client.patch(f"/api/users/{user_id}", json={"active": True, "role": "manager"})
    client.patch(f"/api/users/{user_id}", json={"password": "a brand new password"})
    details = [e["detail"] for e in client.get("/api/audit").json() if e["action"] == "user.updated"]
    assert details == ["sam: password reset", "sam: enabled, role set to manager", "sam: disabled"]


# ---- one workspace cannot see another ---------------------------------------------------------


def test_workspaces_cannot_see_each_others_data(client, catalogue_ids):
    receive = {
        "supplier": "Fresh Foods",
        "lines": [{"product_id": catalogue_ids["sausage"], "name": "Frozen sausage", "quantity": 5, "unit": "pcs", "temp_c": -5}],
    }
    delivery = client.post("/api/deliveries", json=receive).json()

    other = sign_up(workspace="Other Cafe", username="omar", name="Omar Owner")
    for path in ("/api/products", "/api/categories", "/api/deliveries", "/api/audit"):
        assert other.get(path).json() == [], path
    assert [u["username"] for u in other.get("/api/users").json()] == ["omar"]
    assert other.get(f"/api/products/{catalogue_ids['sausage']}").status_code == 404
    assert other.get(f"/api/deliveries/{delivery['id']}").status_code == 404


def test_one_workspace_cannot_change_or_decide_anothers_records(client, catalogue_ids):
    receive = {
        "lines": [{"product_id": catalogue_ids["sausage"], "name": "Frozen sausage", "quantity": 5, "unit": "pcs", "temp_c": -5}]
    }
    delivery = client.post("/api/deliveries", json=receive).json()
    other = sign_up(workspace="Other Cafe", username="omar", name="Omar Owner")

    assert other.post(f"/api/deliveries/{delivery['id']}/decision", json={"decision": "accept"}).status_code == 404
    assert other.delete(f"/api/products/{catalogue_ids['sausage']}").status_code == 404
    assert other.delete(f"/api/categories/{catalogue_ids['frozen_category']}").status_code == 404
    body = {"name": "Mine", "category_id": catalogue_ids["frozen_category"], "base_unit": "pcs"}
    assert other.post("/api/products", json=body).status_code == 422  # not their category
    assert client.get(f"/api/deliveries/{delivery['id']}").json()["status"] == "pending_approval"


def test_the_same_names_can_be_used_in_two_workspaces(client, catalogue_ids):
    other = sign_up(workspace="Other Cafe", username="omar", name="Omar Owner")
    assert other.post("/api/categories", json={"name": "Frozen"}).status_code == 201


def test_another_workspace_cannot_manage_my_people(client, make_user):
    make_user("staff", "sam")
    sam_id = next(u["id"] for u in client.get("/api/users").json() if u["username"] == "sam")
    other = sign_up(workspace="Other Cafe", username="omar", name="Omar Owner")
    assert other.patch(f"/api/users/{sam_id}", json={"active": False}).status_code == 404


def test_the_database_itself_hides_other_workspaces_rows(client, catalogue_ids, _database):
    """Row Level Security: even a query with no workspace filter sees only the current workspace."""
    import psycopg

    other = sign_up(workspace="Other Cafe", username="omar", name="Omar Owner")
    other.post("/api/categories", json={"name": "Dry"})
    ids = {r["id"]: r["name"] for r in client.get("/api/categories").json()}
    other_ids = {r["id"] for r in other.get("/api/categories").json()}
    assert other_ids.isdisjoint(ids)

    # The embedded server's owner is a superuser, who bypasses RLS. Use an ordinary role instead.
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("DROP ROLE IF EXISTS rls_probe")
        conn.execute("CREATE ROLE rls_probe NOSUPERUSER NOBYPASSRLS")
        conn.execute("GRANT ALL ON ALL TABLES IN SCHEMA public TO rls_probe")
        conn.execute("SET ROLE rls_probe")
        conn.execute("SELECT set_config('app.workspace_id', '1', false)")
        seen = {r[0] for r in conn.execute("SELECT id FROM categories").fetchall()}
        assert seen == set(ids)

        conn.execute("SELECT set_config('app.workspace_id', '2', false)")
        seen = {r[0] for r in conn.execute("SELECT id FROM categories").fetchall()}
        assert seen == other_ids
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("INSERT INTO categories (workspace_id, name) VALUES (1, 'sneaky')")

        conn.execute("RESET app.workspace_id")
        assert conn.execute("SELECT count(*) FROM categories").fetchone()[0] == 0
        conn.execute("RESET ROLE")
        conn.execute("DROP OWNED BY rls_probe")
        conn.execute("DROP ROLE rls_probe")


def test_session_says_null_when_signed_out_and_who_you_are_when_signed_in(anon, client):
    resp = anon.get("/api/auth/session")
    assert resp.status_code == 200
    assert resp.json() is None
    assert client.get("/api/auth/session").json()["username"] == "olive"


def test_every_workspace_table_is_protected_by_row_level_security(client, _database):
    import psycopg

    from app.db import RLS_TABLES

    assert {"suppliers", "purchase_orders", "purchase_order_lines"} <= set(RLS_TABLES)
    with psycopg.connect(_database, autocommit=True) as conn:
        for table in RLS_TABLES:
            enabled, forced = conn.execute(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = %s", (table,)
            ).fetchone()
            policies = conn.execute("SELECT count(*) FROM pg_policies WHERE tablename = %s", (table,)).fetchone()[0]
            assert (enabled, forced, policies > 0) == (True, True, True), table


# ---- username rules and input cleaning ----------------------------------------------------------


@pytest.mark.parametrize(
    "username, expected",
    [
        ("lye wei", "letters a-z, numbers"),
        ("LyeWei!", "letters a-z, numbers"),
        ("lyé", "letters a-z, numbers"),
        ("...", "starting and ending with a letter or number"),
        ("-lye", "starting and ending with a letter or number"),
        ("lye@wei.com", "cannot contain @"),
        ("ab", "at least 3 characters"),
    ],
)
def test_a_username_with_spaces_or_symbols_is_refused_with_a_clear_reason(anon, username, expected):
    resp = anon.post("/api/auth/register", json=register_body(username=username))
    assert resp.status_code == 422
    assert expected in resp.json()["detail"]


def test_full_width_letters_from_a_phone_keyboard_become_plain_ones(anon):
    resp = anon.post("/api/auth/register", json=register_body(username="ＬｙｅＷｅｉ", email="lye@example.com"))
    assert resp.status_code == 201, resp.text
    assert resp.json()["username"] == "lyewei"
    # Signing in normalises the same way, whichever way it is typed.
    assert sign_in("ｌｙｅｗｅｉ").get("/api/auth/me").status_code == 200
    assert sign_in(" LyeWei ").get("/api/auth/me").status_code == 200


def test_a_refused_request_never_echoes_the_password(anon):
    resp = anon.post("/api/auth/register", json=register_body(username="bad name", password="secret-but-long"))
    assert resp.status_code == 422
    assert "secret-but-long" not in resp.text
    assert isinstance(resp.json()["detail"], str)


def test_validation_messages_name_the_field(anon):
    resp = anon.post("/api/auth/register", json=register_body(password="short"))
    assert resp.json()["detail"].startswith("Password: ")


def test_invisible_characters_are_removed_from_text(client):
    # A NUL byte used to make the database refuse the row; bidi overrides can disguise a name.
    resp = client.post("/api/categories", json={"name": "Fro\x00zen‮​"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["name"] == "Frozen"
    me = client.patch("/api/auth/me", json={"display_name": "Olive\x07 Owner"}).json()
    assert me["display_name"] == "Olive Owner"


def test_sop_text_keeps_its_line_breaks(client, catalogue_ids):
    body = {"name": "Nuggets", "category_id": catalogue_ids["frozen_category"], "base_unit": "pcs", "sop": "1. Check\r\n2. Store\t-18 C"}
    assert client.post("/api/products", json=body).json()["sop"] == "1. Check\n2. Store\t-18 C"


def test_a_username_can_change_but_the_account_id_stays(client, _database):
    before = client.get("/api/auth/me").json()
    renamed = client.patch("/api/auth/me", json={"username": "Olive.Chef"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["username"] == "olive.chef" and renamed.json()["id"] == before["id"]
    assert sign_in("olive.chef").get("/api/auth/me").json()["id"] == before["id"]
    assert TestClient(app).post("/api/auth/login", json={"username": "olive", "password": PASSWORD}).status_code == 401
    assert "account.username_changed" in [e["action"] for e in client.get("/api/audit").json()]

    sign_up(workspace="Other Kitchen", username="otto")
    taken = client.patch("/api/auth/me", json={"username": "OTTO"})
    assert taken.status_code == 409 and "taken" in taken.json()["detail"]
    assert client.patch("/api/auth/me", json={"username": "a b"}).status_code == 422


def test_ids_cannot_be_changed_even_inside_the_database(_database):
    """Ids are like Discord's: names change, ids never do. PostgreSQL refuses to update them."""
    import psycopg

    with psycopg.connect(_database, autocommit=True) as conn:
        for table in ("workspaces", "users", "outlets", "storages", "products"):
            with pytest.raises(psycopg.errors.GeneratedAlways):
                conn.execute(f"UPDATE {table} SET id = 999999")


def test_a_username_can_be_checked_as_it_is_typed(client):
    check = lambda c, u: c.get("/api/auth/username-available", params={"username": u}).json()
    stranger = TestClient(app)
    assert check(stranger, "OLIVE") == {"username": "olive", "available": False, "problem": "that username is already taken"}
    assert check(stranger, "new.cook")["available"] is True
    assert check(stranger, "a b")["available"] is False
    assert check(client, "olive")["available"] is True  # your own

    for _ in range(30):
        stranger.get("/api/auth/username-available", params={"username": "zed"})
    assert stranger.get("/api/auth/username-available", params={"username": "zed"}).status_code == 429


def test_a_made_up_forwarded_address_does_not_dodge_the_limit(anon):
    # Behind Google's load balancer the header reads "<typed>, <client>, <load balancer>".
    check = lambda typed: anon.get(
        "/api/auth/username-available", params={"username": "zed"},
        headers={"X-Forwarded-For": f"{typed}, 198.51.100.7, 34.117.33.233"},
    ).status_code
    for n in range(30):
        assert check(f"203.0.113.{n}") == 200
    assert check("203.0.113.99") == 429
