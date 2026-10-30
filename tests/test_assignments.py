"""PICs: who may take a job, asking to take over, manager decisions, and the jobs each day brings."""

from datetime import date, timedelta

from test_purchasing import issued_order, supplier_id  # noqa: F401 - fixture

TODAY = date.today()


def _jobs(c, day=TODAY):
    resp = c.get("/api/jobs", params={"day": day.isoformat()})
    assert resp.status_code == 200, resp.text
    return {(j["kind"], j["ref_id"]): j for j in resp.json()}


def _activity(client):
    return [e["action"] for e in client.get("/api/audit").json()]


def test_an_issued_order_is_a_job_that_says_what_to_do_as_its_date_nears(client, catalogue_ids, supplier_id):  # noqa: F811
    due = TODAY + timedelta(days=1)
    order = issued_order(client, catalogue_ids, supplier_id, expected_date=due.isoformat())
    job = _jobs(client)[("po", order["id"])]
    assert job["when"] == "Due tomorrow: check it is on the way"
    assert _jobs(client, due)[("po", order["id"])]["when"] == "Due today: get ready to check temperatures and packs"
    assert _jobs(client, due + timedelta(days=2))[("po", order["id"])]["when"] == "2 days late: call the supplier"


def test_staff_take_a_free_job_and_ask_to_take_over_a_taken_one(client, catalogue_ids, supplier_id, make_user):  # noqa: F811
    order = issued_order(client, catalogue_ids, supplier_id)
    sam, sue = make_user("staff", "sam", "Sam Staff"), make_user("staff", "sue", "Sue Staff")
    take = {"kind": "po", "ref_id": order["id"]}
    assert sam.post("/api/assignments", json=take).json() == {"status": "assigned"}
    assert sam.post("/api/assignments", json=take).json() == {"status": "already"}  # idempotent
    assert _jobs(sue)[("po", order["id"])]["can_take"] is False
    # Not a big order and it has a PIC: Sue's go is a request, and asking twice is one request.
    assert sue.post("/api/assignments", json=take).json() == {"status": "requested"}
    assert sue.post("/api/assignments", json=take).json() == {"status": "requested"}
    pending = client.get("/api/assignment-requests").json()
    assert [(r["name"], r["replaces"]) for r in pending] == [("Sue Staff", ["Sam Staff"])]
    # The manager approves twice; the second time changes nothing.
    for _ in range(2):
        assert client.post(f"/api/assignment-requests/{pending[0]['id']}/decision", json={"approve": True}).status_code == 204
    assert [p["name"] for p in _jobs(client)[("po", order["id"])]["pics"]] == ["Sue Staff"]
    assert client.get("/api/assignment-requests").json() == []
    log = _activity(client)
    assert log.count("assignment.added") == 1 and log.count("assignment.requested") == 1 and log.count("assignment.approved") == 1


def test_a_big_order_takes_a_second_pic_without_asking(client, catalogue_ids, supplier_id, make_user):  # noqa: F811
    assert client.patch("/api/workspace", json={"big_order_lines": 2}).status_code == 200
    order = issued_order(client, catalogue_ids, supplier_id)  # two lines: big now
    sam, sue, max_ = make_user("staff", "sam"), make_user("staff", "sue"), make_user("staff", "max")
    take = {"kind": "po", "ref_id": order["id"]}
    assert sam.post("/api/assignments", json=take).json()["status"] == "assigned"
    assert sue.post("/api/assignments", json=take).json()["status"] == "assigned"
    assert max_.post("/api/assignments", json=take).json()["status"] == "requested"  # two PICs is the most


def test_only_managers_assign_others_and_staff_only_leave_themselves(client, catalogue_ids, supplier_id, make_user):  # noqa: F811
    order = issued_order(client, catalogue_ids, supplier_id)
    sam = make_user("staff", "sam")
    sam_id = next(u["id"] for u in client.get("/api/users").json() if u["username"] == "sam")
    me = client.get("/api/auth/me").json()["id"]
    assert sam.post("/api/assignments", json={"kind": "po", "ref_id": order["id"], "user_id": me}).status_code == 403
    assert client.post("/api/assignments", json={"kind": "po", "ref_id": order["id"], "user_id": sam_id}).json()["status"] == "assigned"
    # A manager adds themselves next to a PIC without asking.
    assert client.post("/api/assignments", json={"kind": "po", "ref_id": order["id"]}).json()["status"] == "assigned"
    assert sam.delete(f"/api/assignments/po/{order['id']}/{me}").status_code == 403
    assert sam.delete(f"/api/assignments/po/{order['id']}/{sam_id}").status_code == 204
    assert sam.delete(f"/api/assignments/po/{order['id']}/{sam_id}").status_code == 204  # idempotent
    assert _activity(client).count("assignment.removed") == 1


def test_a_planned_count_is_a_job_until_that_storage_area_is_counted(client, catalogue_ids, make_user):
    sam = make_user("staff", "sam", "Sam Staff")
    sam_id = next(u["id"] for u in client.get("/api/users").json() if u["username"] == "sam")
    count = client.post("/api/stocktakes", json={
        "count_date": TODAY.isoformat(),
        "lines": [{"product_id": catalogue_ids["fries"], "expected_stock": 0, "counted_stock": 0}],
    })
    assert count.status_code == 201, count.text
    storage = client.get("/api/outlets").json()[0]["storages"][0]["id"]
    plan = {"storage_id": storage, "due_date": TODAY.isoformat(), "user_id": sam_id}
    assert client.post("/api/count-plans", json=plan).status_code == 204
    job = next(j for j in _jobs(sam).values() if j["kind"] == "count")
    assert (job["when"], [p["name"] for p in job["pics"]]) == ("Count it today", ["Sam Staff"])
    client.post("/api/stocktakes", json={
        "count_date": TODAY.isoformat(),
        "lines": [{"product_id": catalogue_ids["fries"], "expected_stock": 0, "counted_stock": 0}],
    })
    assert all(j["kind"] != "count" for j in _jobs(sam).values())


def test_team_stats_count_late_jobs_counts_and_who_may_see_them(client, catalogue_ids, make_user):
    sam, sue = make_user("manager", "sam", "Sam Staff"), make_user("staff", "sue")
    sam_id = next(u["id"] for u in client.get("/api/users").json() if u["username"] == "sam")
    storage = client.get("/api/outlets").json()[0]["storages"][0]["id"]
    plan = {"storage_id": storage, "due_date": (TODAY - timedelta(days=1)).isoformat(), "user_id": sam_id}
    assert client.post("/api/count-plans", json=plan).status_code == 204
    # Sam counts the next day, so the planned count was late.
    assert sam.post("/api/stocktakes", json={
        "count_date": TODAY.isoformat(),
        "lines": [{"product_id": catalogue_ids["fries"], "expected_stock": 0, "counted_stock": 2}],
    }).status_code == 201
    stats = {r["name"]: r for r in client.get("/api/team/efficiency").json()}
    assert (stats["Sam Staff"]["jobs_due"], stats["Sam Staff"]["jobs_on_time"], stats["Sam Staff"]["counts"]) == (1, 0, 1)
    assert stats["Olive Owner"]["counts"] == 0
    assert sue.get("/api/team/efficiency").status_code == 403
