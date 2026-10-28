"""Branch workspaces linked to an HQ with a one-time code, and HQ people working in a branch."""

import psycopg

from conftest import PASSWORD, sign_in, sign_up

HEADER = "X-SOPBox-Workspace"


def _link(hq, branch):
    code = hq.post("/api/workspace/link-codes")
    assert code.status_code == 201, code.text
    joined = branch.post("/api/workspace/hq", json={"code": code.json()["code"]})
    assert joined.status_code == 200, joined.text
    return code.json()["code"]


def _workspace_id(client):
    return client.get("/api/auth/me").json()["workspace"]["id"]


def test_a_code_links_a_branch_once_and_hq_works_there_as_a_manager(client):
    branch = sign_up(workspace="Branch Ipoh", username="bella")
    code = _link(client, branch)
    branch_id = _workspace_id(branch)

    assert branch.get("/api/workspace/links").json()["hq"]["name"] == "Test Kitchen"
    assert [b["name"] for b in client.get("/api/workspace/links").json()["branches"]] == ["Branch Ipoh"]
    me = client.get("/api/auth/me").json()
    assert [(w["name"], w["role"]) for w in me["workspaces"]] == [("Test Kitchen", "owner"), ("Branch Ipoh", "manager")]

    # The code is used up, even for another workspace.
    third = sign_up(workspace="Branch Penang", username="penny")
    reused = third.post("/api/workspace/hq", json={"code": code})
    assert reused.status_code == 422 and "not valid" in reused.json()["detail"]

    # HQ's owner works in the branch's data, as a manager: no team changes there.
    made = client.post("/api/categories", json={"name": "Dry goods"}, headers={HEADER: str(branch_id)})
    assert made.status_code == 201
    assert [c["name"] for c in branch.get("/api/categories").json()] == ["Dry goods"]
    assert client.get("/api/categories").json() == []
    assert client.get("/api/users", headers={HEADER: str(branch_id)}).status_code == 403
    # Account routes always stay in the person's own workspace.
    assert client.get("/api/auth/me", headers={HEADER: str(branch_id)}).json()["workspace"]["name"] == "Test Kitchen"


def test_branch_people_and_strangers_cannot_reach_other_workspaces(client):
    branch = sign_up(workspace="Branch Ipoh", username="bella")
    _link(client, branch)
    stranger = sign_up(workspace="Elsewhere", username="eve")

    assert branch.get("/api/categories", headers={HEADER: str(_workspace_id(client))}).status_code == 403
    assert stranger.get("/api/categories", headers={HEADER: str(_workspace_id(branch))}).status_code == 403
    assert client.get("/api/categories", headers={HEADER: str(_workspace_id(stranger))}).status_code == 403
    assert client.get("/api/categories", headers={HEADER: "not-a-number"}).status_code == 403


def test_hq_staff_keep_their_hq_section_access_in_branches(client, make_user):
    branch = sign_up(workspace="Branch Ipoh", username="bella")
    _link(client, branch)
    staff = make_user()  # default access: stock count view, no activity log
    branch_id = str(_workspace_id(branch))
    assert staff.get("/api/stocktakes", headers={HEADER: branch_id}).status_code == 200
    assert staff.get("/api/audit", headers={HEADER: branch_id}).status_code == 403
    assert [w["role"] for w in staff.get("/api/auth/me").json()["workspaces"]] == ["staff", "staff"]


def test_expired_and_wrong_codes_fail_and_either_owner_can_unlink(client, _database):
    branch = sign_up(workspace="Branch Ipoh", username="bella")
    code = client.post("/api/workspace/link-codes").json()["code"]
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("UPDATE link_codes SET expires_at = now() - interval '1 minute'")
    assert branch.post("/api/workspace/hq", json={"code": code}).status_code == 422
    assert branch.post("/api/workspace/hq", json={"code": "guess"}).status_code == 422
    # The HQ cannot enter its own code.
    own = client.post("/api/workspace/link-codes").json()["code"]
    assert client.post("/api/workspace/hq", json={"code": own}).status_code == 422

    _link(client, branch)
    branch_id = _workspace_id(branch)
    # A branch cannot become an HQ itself.
    assert branch.post("/api/workspace/link-codes").status_code == 409
    left = branch.delete("/api/workspace/hq")
    assert left.status_code == 200 and left.json()["hq"] is None
    assert client.get("/api/categories", headers={HEADER: str(branch_id)}).status_code == 403

    _link(client, branch)
    assert client.delete(f"/api/workspace/branches/{branch_id}").json()["branches"] == []
    assert client.delete(f"/api/workspace/branches/{branch_id}").status_code == 404


def test_only_owners_link_workspaces(client, make_user):
    manager = make_user("manager")
    assert manager.post("/api/workspace/link-codes").status_code == 403
    assert manager.post("/api/workspace/hq", json={"code": "x"}).status_code == 403
    assert sign_in("olive", PASSWORD).get("/api/workspace/links").status_code == 200
