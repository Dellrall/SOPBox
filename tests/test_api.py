"""Who may do what: sign-in is required, and the role decides the rest."""

import pytest


def test_health_needs_no_sign_in(anon):
    assert anon.get("/api/health").json() == {"status": "ok"}


@pytest.mark.parametrize(
    "path",
    [
        "/api/categories",
        "/api/products",
        "/api/deliveries",
        "/api/audit",
        "/api/users",
        "/api/workspace",
        "/api/auth/me",
    ],
)
def test_every_data_route_needs_a_sign_in(anon, path):
    assert anon.get(path).status_code == 401


def test_writes_need_a_sign_in_too(anon):
    assert anon.post("/api/categories", json={"name": "Frozen"}).status_code == 401
    assert anon.post("/api/deliveries", json={"lines": []}).status_code == 401
    assert anon.post("/api/extract", json={"image_b64": "x"}).status_code == 401


def test_staff_can_read_and_receive_but_not_change_rules(client, catalogue_ids, make_user):
    staff = make_user("staff")
    pid = catalogue_ids["sausage"]
    body = {"name": "Frozen sausage", "category_id": catalogue_ids["frozen_category"], "base_unit": "pcs"}

    for path in ("/api/categories", "/api/products", "/api/deliveries"):
        assert staff.get(path).status_code == 200, path
    line = {"product_id": pid, "name": "Frozen sausage", "quantity": 5, "unit": "pcs", "temp_c": -15}
    assert staff.post("/api/deliveries", json={"lines": [line]}).status_code == 201

    assert staff.post("/api/categories", json={"name": "Dry"}).status_code == 403
    assert staff.put(f"/api/products/{pid}", json=body).status_code == 403
    assert staff.delete(f"/api/products/{pid}").status_code == 403
    assert staff.get("/api/audit").status_code == 403
    assert staff.get("/api/users").status_code == 403


def test_a_manager_edits_the_catalogue_but_does_not_manage_people(client, catalogue_ids, make_user):
    manager = make_user("manager")
    assert manager.post("/api/categories", json={"name": "Dry"}).status_code == 201
    assert manager.get("/api/audit").status_code == 200
    assert manager.get("/api/users").status_code == 403
    assert manager.patch("/api/workspace", json={"name": "Hijacked"}).status_code == 403


def test_responses_carry_the_security_headers(anon):
    for path in ("/api/health", "/api/nope", "/api/products"):
        resp = anon.get(path)
        assert "frame-ancestors 'none'" in resp.headers["Content-Security-Policy"]
        assert "unsafe-inline" not in resp.headers["Content-Security-Policy"]
        assert resp.headers["X-Content-Type-Options"] == "nosniff"
        assert resp.headers["Strict-Transport-Security"].startswith("max-age=")
        assert resp.headers["Referrer-Policy"] == "no-referrer"
