"""Tagging teammates, each person's inbox, and per-person accountability."""

from test_deliveries_api import decide, photo, sausage_line

from conftest import sign_up


def team_ids(client):
    return {m["username"]: m["id"] for m in client.get("/api/team").json()}


def inbox(client):
    resp = client.get("/api/inbox")
    assert resp.status_code == 200, resp.text
    return resp.json()


def receive(client, ids, tagged=(), photos=(), **line):
    resp = client.post(
        "/api/deliveries",
        json={"supplier": "Fresh Foods", "lines": [sausage_line(ids, **line)], "tagged_user_ids": list(tagged), "photos": list(photos)},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_tagging_on_receive_shows_on_the_delivery_and_in_their_inbox(client, catalogue_ids, make_user):
    chef = make_user("staff", "chef", "Chef Kim")
    staff = make_user("staff", "sam", "Sam")
    delivery = receive(staff, catalogue_ids, tagged=[team_ids(client)["chef"]])

    assert [(t["username"], t["tagged_by"]) for t in delivery["tags"]] == [("chef", "Sam")]
    box = inbox(chef)
    assert box["unread"] == 1
    assert box["items"][0]["kind"] == "tagged"
    assert box["items"][0]["delivery_id"] == delivery["id"]
    assert "Sam tagged you" in box["items"][0]["body"]
    assert inbox(staff)["unread"] == 0  # nobody is told about their own action


def test_only_teammates_from_this_workspace_can_be_tagged(client, catalogue_ids):
    other = sign_up("Other Kitchen", "otto", "Otto")
    otto_id = team_ids(other)["otto"]
    resp = client.post(
        "/api/deliveries",
        json={"supplier": "x", "lines": [sausage_line(catalogue_ids)], "tagged_user_ids": [otto_id]},
    )
    assert resp.status_code == 422
    assert client.get("/api/deliveries").json() == []  # nothing saved
    assert inbox(other)["unread"] == 0


def test_a_failed_delivery_tells_everyone_who_can_approve(client, catalogue_ids, make_user):
    manager = make_user("manager", "mia", "Mia")
    staff = make_user("staff", "sam", "Sam")
    delivery = receive(staff, catalogue_ids, temp_c=5)  # too warm: waits for a manager

    assert delivery["status"] == "pending_approval"
    for approver in (client, manager):
        item = inbox(approver)["items"][0]
        assert item["kind"] == "approval_needed" and item["delivery_id"] == delivery["id"]
    assert inbox(staff)["unread"] == 0  # staff cannot approve by default


def test_the_receiver_and_tagged_people_hear_the_decision(client, catalogue_ids, make_user):
    chef = make_user("staff", "chef", "Chef Kim")
    staff = make_user("staff", "sam", "Sam")
    delivery = receive(staff, catalogue_ids, tagged=[team_ids(client)["chef"]], temp_c=5)
    assert decide(client, delivery["id"], decision="reject", reason="too warm").status_code == 200

    for person in (staff, chef):
        item = inbox(person)["items"][0]
        assert item["kind"] == "decided"
        assert "rejected by Olive Owner" in item["body"] and "too warm" in item["body"]


def test_a_mention_tags_the_teammate_and_others_involved_hear_about_the_comment(client, catalogue_ids, make_user):
    chef = make_user("staff", "chef", "Chef Kim")
    staff = make_user("staff", "sam", "Sam")
    delivery = receive(staff, catalogue_ids, photos=[photo()], temp_c=5)
    url = f"/api/deliveries/{delivery['id']}/photos/{delivery['photos'][0]['id']}/comments"

    resp = client.post(url, json={"body": "@Chef, is this box usable? cc @nobody"})
    assert resp.status_code == 201, resp.text
    assert [t["username"] for t in resp.json()["tags"]] == ["chef"]
    assert inbox(chef)["items"][0]["kind"] == "tagged"
    assert "mentioned you" in inbox(chef)["items"][0]["body"]
    assert inbox(staff)["items"][0]["kind"] == "comment"  # they received it


def test_tags_can_be_added_and_removed_later_and_both_are_logged(client, catalogue_ids, make_user):
    make_user("staff", "chef", "Chef Kim")
    delivery = receive(client, catalogue_ids)
    chef_id = team_ids(client)["chef"]

    tagged = client.post(f"/api/deliveries/{delivery['id']}/tags", json={"user_ids": [chef_id]})
    assert [t["user_id"] for t in tagged.json()["tags"]] == [chef_id]
    # Tagging twice does not tag or notify twice.
    client.post(f"/api/deliveries/{delivery['id']}/tags", json={"user_ids": [chef_id]})
    untagged = client.delete(f"/api/deliveries/{delivery['id']}/tags/{chef_id}")
    assert untagged.json()["tags"] == []
    assert client.delete(f"/api/deliveries/{delivery['id']}/tags/{chef_id}").status_code == 404

    actions = [e["action"] for e in client.get("/api/audit").json()]
    assert actions.count("delivery.tagged") == 1 and "delivery.untagged" in actions


def test_marking_read_only_touches_your_own_inbox(client, catalogue_ids, make_user):
    manager = make_user("manager", "mia", "Mia")
    staff = make_user("staff", "sam", "Sam")
    receive(staff, catalogue_ids, temp_c=5)
    receive(staff, catalogue_ids, temp_c=6)
    first = inbox(manager)["items"][0]["id"]

    assert manager.post("/api/inbox/read", json={"ids": [first]}).status_code == 204
    assert inbox(manager)["unread"] == 1
    # The owner's notification ids are not the manager's to mark.
    owner_ids = [i["id"] for i in inbox(client)["items"]]
    manager.post("/api/inbox/read", json={"ids": owner_ids})
    assert inbox(client)["unread"] == 2
    manager.post("/api/inbox/read", json={})
    assert inbox(manager)["unread"] == 0


def test_actions_count_for_the_account_even_after_a_name_change(client, catalogue_ids, make_user):
    staff = make_user("staff", "sam", "Sam")
    receive(staff, catalogue_ids)
    assert staff.patch("/api/auth/me", json={"display_name": "Samantha"}).status_code == 200
    receive(staff, catalogue_ids)
    sam_id = team_ids(client)["sam"]

    rows = {r["username"]: r for r in client.get("/api/team/accountability").json()}
    assert rows["sam"]["received"] == 2
    assert rows["olive"]["received"] == 0
    mine = client.get(f"/api/audit?actor_id={sam_id}").json()
    assert {e["actor"] for e in mine} == {"Sam", "Samantha"}
    assert all(e["actor_id"] == sam_id for e in mine)
    # Automatic acceptance is the system's, not the receiver's.
    assert all(e["actor_id"] is None for e in client.get("/api/audit").json() if e["actor"] == "system")


def test_accountability_is_for_the_owner_only(client, make_user):
    manager = make_user("manager", "mia", "Mia")
    assert manager.get("/api/team/accountability").status_code == 403
    assert manager.get("/api/team").status_code == 200
