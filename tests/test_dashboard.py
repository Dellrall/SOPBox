"""The dashboard's chart data: deliveries from the last 15 days and what happened to them."""

import psycopg

from test_deliveries_api import receive, sausage_line


def test_recent_activity_lists_this_fortnights_deliveries_oldest_first(client, catalogue_ids, _database):
    ids = catalogue_ids
    old = receive(client, ids, sausage_line(ids))
    accepted = receive(client, ids, sausage_line(ids))
    held = receive(client, ids, sausage_line(ids, temp_c=5))
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("UPDATE deliveries SET created_at = '2020-01-01T00:00:00+00:00' WHERE id = %s", (old["id"],))

    activity = client.get("/api/dashboard").json()["recent_activity"]

    assert [a["status"] for a in activity] == ["accepted", "pending_approval"]
    assert activity[0]["created_at"] == accepted["created_at"] and activity[1]["created_at"] == held["created_at"]


def test_recent_activity_is_only_this_workspaces(client, catalogue_ids, anon):
    receive(client, catalogue_ids, sausage_line(catalogue_ids))
    from conftest import sign_up

    other = sign_up(workspace="Other Kitchen", username="oscar")
    assert other.get("/api/dashboard").json()["recent_activity"] == []
