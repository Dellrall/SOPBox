"""The owner's setup checklist ticks itself off from what the workspace has."""


def test_setup_steps_tick_off_as_the_workspace_fills(client, make_user):
    assert client.get("/api/setup").json() == {"outlet": False, "storage": False, "product": False, "team": False, "delivery": False}
    outlet = client.get("/api/outlets").json()[0]
    client.put(f"/api/outlets/{outlet['id']}", json={"name": "Kedai Gombak"})
    client.post("/api/storages", json={"outlet_id": outlet["id"], "name": "Chiller"})
    staff = make_user("staff")
    done = client.get("/api/setup").json()
    assert (done["outlet"], done["storage"], done["team"]) == (True, True, True)
    assert staff.get("/api/setup").status_code == 403
