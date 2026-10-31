"""Sales read with AI: code matches what it can, the AI suggests or asks about the rest, a person
confirms, the match is remembered, and a till's unmatched sale waits for a person."""

import base64

from app import sales_ai
from test_apikeys import _key, _till
from test_locations import _count, _stock, _storages, _with_code


def _ai(monkeypatch, replies):
    """Stand in for the paid AI: each call returns the next reply and records what it was sent."""
    sent = []

    def chat(content, system, max_tokens=8000):
        sent.append(content)
        return replies.pop(0)

    monkeypatch.setattr(sales_ai, "_chat", chat)
    monkeypatch.setattr(sales_ai, "available", lambda: True)
    return sent


def test_a_sheet_is_matched_by_code_and_the_ai_asks_about_a_set(client, catalogue_ids, monkeypatch):
    fries, sausage = catalogue_ids["fries"], catalogue_ids["sausage"]
    _with_code(client, fries, "1001")
    store = _storages(client)["Main outlet / Store"]
    _count(client, store, fries, 0, 100)
    _count(client, store, sausage, 0, 100)
    sheet = "Item,Code,Qty\nFries,1001,4\nHot Dog Set,,3\nService charge,,1\n"
    sent = _ai(monkeypatch, [{"lines": [
        {"i": 1, "components": [{"product_id": sausage, "per_sold": 2}, {"product_id": 99999, "per_sold": 1}], "sure": False,
         "question": "Does a Hot Dog Set come with fries?"},
        {"i": 2, "not_stock": True, "components": [], "sure": True},
    ]}])

    read = client.post("/api/sales/read", json={"storage_id": store, "filename": "day.csv",
                                                "data": base64.b64encode(sheet.encode()).decode()})
    assert read.status_code == 200, read.text
    lines = read.json()["lines"]
    assert [(l["name"], l["status"], l["source"]) for l in lines] == [
        ("Fries", "matched", "code"), ("Hot Dog Set", "question", "ai"), ("Service charge", "not_stock", "ai")]
    assert lines[1]["question"] == "Does a Hot Dog Set come with fries?"
    assert [c["product_id"] for c in lines[1]["components"]] == [sausage]  # the made-up product is dropped
    assert "Hot Dog Set" in sent[0] and "Fries" not in sent[0].split("Sold items")[1]  # only the unmatched line
    assert [(t["product_id"], t["quantity"]) for t in read.json()["totals"]] == [(fries, 4)]  # questions add nothing yet

    done = client.post("/api/sales/confirm", json={"storage_id": store, "sale_date": "2026-10-30", "lines": [
        {"name": "Fries", "quantity": 4, "components": [{"product_id": fries, "per_sold": 1}], "remember": False},
        {"name": "Hot Dog Set", "quantity": 3, "components": [{"product_id": sausage, "per_sold": 2}, {"product_id": fries, "per_sold": 1}]},
        {"name": "Service charge", "quantity": 1, "not_stock": True},
    ]})
    assert done.status_code == 201, done.text
    assert _stock(client, store, fries)["quantity"] == 93 and _stock(client, store, sausage)["quantity"] == 94

    # Remembered: the next read needs no AI, whatever the spacing and case.
    _ai(monkeypatch, [])
    again = client.post("/api/sales/read", json={"storage_id": store, "items": [
        {"name": "hot-dog  SET", "quantity": 2}, {"name": "Service Charge", "quantity": 1}]}).json()
    assert [(l["status"], l["source"]) for l in again["lines"]] == [("matched", "saved"), ("not_stock", "saved")]
    assert sorted((t["product_id"], t["quantity"]) for t in again["totals"]) == sorted([(sausage, 4), (fries, 2)])
    assert not again["ai_used"]


def test_a_line_with_nothing_picked_is_refused(client, catalogue_ids):
    store = _storages(client)["Main outlet / Store"]
    resp = client.post("/api/sales/confirm", json={"storage_id": store, "sale_date": "2026-10-30",
                                                   "lines": [{"name": "Mystery", "quantity": 1}]})
    assert resp.status_code == 422 and "Mystery" in resp.text


def test_a_till_sale_with_an_unknown_item_waits_for_a_person(client, catalogue_ids, monkeypatch):
    fries = catalogue_ids["fries"]
    store = _storages(client)["Main outlet / Store"]
    _count(client, store, fries, 0, 50)
    till = _till(_key(client, store)["key"])
    body = {"sale_date": "2026-10-30", "reference": "Z-9",
            "items": [{"name": "Fries tray", "quantity": 5}, {"name": "Combo A", "quantity": 2}]}
    sent = till.post("/api/v1/sales/items", json=body)
    assert sent.status_code == 201, sent.text
    assert sent.json()["status"] == "needs_review" and sent.json()["unmatched"] == ["Combo A"]
    assert till.post("/api/v1/sales/items", json=body).json()["draft_id"] == sent.json()["draft_id"]  # resent: kept once
    assert _stock(client, store, fries)["quantity"] == 50

    drafts = client.get("/api/sales/drafts").json()
    assert [d["id"] for d in drafts] == [sent.json()["draft_id"]]
    _ai(monkeypatch, [{"lines": [{"i": 1, "components": [{"product_id": fries, "per_sold": 2}], "sure": True}]}])
    read = client.post("/api/sales/read", json={"storage_id": store, "draft_id": drafts[0]["id"]}).json()
    assert [l["status"] for l in read["lines"]] == ["matched", "suggested"]
    done = client.post("/api/sales/confirm", json={"storage_id": store, "sale_date": "2026-10-30", "draft_id": drafts[0]["id"],
                                                   "lines": [{"name": "Fries tray", "quantity": 5, "components": [{"product_id": fries, "per_sold": 1}]},
                                                             {"name": "Combo A", "quantity": 2, "components": [{"product_id": fries, "per_sold": 2}]}]})
    assert done.status_code == 201, done.text
    assert _stock(client, store, fries)["quantity"] == 41
    assert client.get("/api/sales/drafts").json() == []

    # Now everything is known: the till's next sale is recorded straight away.
    later = till.post("/api/v1/sales/items", json={"sale_date": "2026-10-31", "items": [{"name": "combo a", "quantity": 1}]}).json()
    assert later["status"] == "recorded" and _stock(client, store, fries)["quantity"] == 39
