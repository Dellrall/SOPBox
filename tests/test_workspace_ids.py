"""The workspace id people see (addresses, Settings) is random, so it says nothing about how many
workspaces there are, and it never repeats."""

import re

import psycopg
import pytest

from conftest import sign_up


def test_each_workspace_gets_its_own_random_public_id(client):
    other = sign_up("Second Kitchen", "bea")
    mine, theirs = (c.get("/api/auth/me").json()["workspace"] for c in (client, other))
    assert re.fullmatch(r"[0-9a-f]{12}", mine["public_id"]) and mine["public_id"] != theirs["public_id"]
    assert client.get("/api/workspace").json()["public_id"] == mine["public_id"]
    assert client.get("/api/auth/me").json()["workspaces"][0]["public_id"] == mine["public_id"]


def test_the_database_refuses_a_repeated_public_id(client, _database):
    with psycopg.connect(_database, autocommit=True) as conn:
        taken = conn.execute("SELECT public_id FROM workspaces").fetchone()[0]
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute("INSERT INTO workspaces (name, created_at, public_id) VALUES ('Copy', 'now', %s)", (taken,))


def test_signing_up_retries_when_the_random_id_repeats(client, _database):
    """Force the next random id to be one already taken: the sign-up still works, with a fresh id."""
    taken = client.get("/api/auth/me").json()["workspace"]["public_id"]
    default = "substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)"
    with psycopg.connect(_database, autocommit=True) as conn:
        conn.execute("CREATE SEQUENCE repeat_once")
        conn.execute(
            "CREATE FUNCTION repeat_once() RETURNS text LANGUAGE sql SECURITY DEFINER AS "
            f"$$ SELECT CASE WHEN nextval('repeat_once') = 1 THEN '{taken}' ELSE {default} END $$"
        )
        conn.execute("ALTER TABLE workspaces ALTER COLUMN public_id SET DEFAULT repeat_once()")
    try:
        other = sign_up("Second Kitchen", "bea").get("/api/auth/me").json()["workspace"]["public_id"]
        assert re.fullmatch(r"[0-9a-f]{12}", other) and other != taken
    finally:
        with psycopg.connect(_database, autocommit=True) as conn:
            conn.execute(f"ALTER TABLE workspaces ALTER COLUMN public_id SET DEFAULT {default}")
            conn.execute("DROP FUNCTION repeat_once()")
            conn.execute("DROP SEQUENCE repeat_once")
