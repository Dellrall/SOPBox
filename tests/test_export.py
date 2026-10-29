"""Anyone can download their data; what is in it follows what they can see."""

import io
import json
import zipfile


def _files(client):
    resp = client.get("/api/export")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-disposition"].startswith('attachment; filename="sopbox-export-')
    return zipfile.ZipFile(io.BytesIO(resp.content))


def test_the_owner_gets_the_whole_workspace_without_secrets(client, catalogue_ids):
    archive = _files(client)
    names = set(archive.namelist())
    assert {"my-account.json", "products.csv", "deliveries.csv", "audit_log.csv", "team.csv", "api_keys.csv"} <= names
    team = archive.read("team.csv").decode("utf-8-sig")
    assert "olive" in team and "password_hash" not in team and "pin_hash" not in team
    assert "Fries tray" in archive.read("products.csv").decode("utf-8-sig")
    account = json.loads(archive.read("my-account.json"))
    assert account["account"]["username"] == "olive" and account["sign_ins"]
    assert "password_hash" not in json.dumps(account)


def test_staff_get_their_account_and_only_their_sections(client, catalogue_ids, make_user):
    staff = make_user("staff")  # default access: products, records, stocktake to view; no activity or purchasing
    names = set(_files(staff).namelist())
    assert "my-account.json" in names and "products.csv" in names
    assert not names & {"audit_log.csv", "suppliers.csv", "team.csv", "api_keys.csv"}


def test_a_formula_in_a_name_is_not_run_by_a_spreadsheet(client, catalogue_ids):
    client.post("/api/categories", json={"name": "=HYPERLINK(1)"})
    assert "'=HYPERLINK(1)" in _files(client).read("categories.csv").decode("utf-8-sig")
