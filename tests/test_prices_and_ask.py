"""Delivered prices, price-change alerts, the value of count gaps, and questions to the helper."""

from datetime import date

from app import extraction
from app.extraction import parse_model_output

TODAY = date.today().isoformat()


def receive_fries(client, ids, packs, price_sen, supplier="Fresh Foods"):
    line = {"product_id": ids["fries"], "name": "Fries tray", "quantity": packs, "unit": "bdl", "unit_price_sen": price_sen}
    resp = client.post("/api/deliveries", json={"supplier": supplier, "lines": [line]})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_a_price_rise_per_base_unit_is_flagged_and_a_small_one_clears_it(client, catalogue_ids):
    ids = catalogue_ids
    first = receive_fries(client, ids, 2, 5000)  # RM50 a bundle of 250: 20 sen a tray
    assert first["lines"][0]["unit_price_sen"] == 5000
    assert client.get("/api/insights/price-changes").json() == []

    receive_fries(client, ids, 1, 6000, supplier="Fry House")  # 24 sen a tray: up 20%
    [change] = client.get("/api/insights/price-changes").json()
    assert (change["product_name"], change["supplier"], change["before_sen"], change["now_sen"], change["change"]) == (
        "Fries tray", "Fry House", 20, 24, 0.2,
    )

    receive_fries(client, ids, 1, 6300)  # up 5% on the delivery before: nothing to flag
    assert client.get("/api/insights/price-changes").json() == []


def test_a_count_gap_is_valued_at_the_latest_price(client, catalogue_ids):
    ids = catalogue_ids
    receive_fries(client, ids, 2, 5000)
    receive_fries(client, ids, 1, 6000)  # 24 sen a tray; 750 trays in stock
    st = client.post("/api/stocktakes", json={
        "count_date": TODAY, "lines": [{"product_id": ids["fries"], "expected_stock": 750, "counted_stock": 740}],
    }).json()
    [gap] = client.get(f"/api/stocktakes/{st['id']}/insights").json()["gaps"]
    assert gap["value_sen"] == -240


def test_the_reader_takes_a_printed_price_and_drops_one_it_cannot_read():
    lines = parse_model_output(
        '{"lines": [{"name": "Rice", "quantity": 2, "unit": "bag", "unit_price": "RM 1,250.50"},'
        ' {"name": "Oil", "quantity": 1, "unit": "tin", "unit_price": "n/a"},'
        ' {"name": "Salt", "quantity": 1, "unit": "pkt", "unit_price": -3}]}'
    )
    assert [l.unit_price for l in lines] == [1250.5, None, None]


def ask(client, question):
    resp = client.post("/api/ask", json={"question": question})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_questions_by_their_words_are_answered_from_the_records(client, catalogue_ids):
    ids = catalogue_ids
    receive_fries(client, ids, 2, 5000)
    receive_fries(client, ids, 1, 6000)
    client.post("/api/stocktakes", json={
        "count_date": TODAY, "lines": [{"product_id": ids["fries"], "expected_stock": 750, "counted_stock": 740}],
    })

    waste = ask(client, "What went missing this week?")
    assert waste["topic"] == "waste" and waste["to"] == "stocktake"
    assert "last 7 days" in waste["text"] and "about RM2.40" in waste["text"]
    assert waste["items"] == ["Fries tray: 10 pcs missing (about RM2.40)"]

    prices = ask(client, "Harga naik ke?")
    assert prices["topic"] == "prices"
    assert prices["items"] == ["Fries tray from Fresh Foods: up 20%, RM0.20 to RM0.24 per pcs"]

    assert ask(client, "What should we order?")["items"][0].startswith("Frozen sausage: 50 pcs.")
    assert ask(client, "Any deliveries waiting for approval?")["text"] == "No delivery is waiting for a manager."
    assert ask(client, "How fast do we use fries tray?")["text"].startswith("Fries tray: about 1.4 pcs a day lately.")
    assert ask(client, "How long will it last?")["text"].startswith("Which product?")


def test_other_questions_go_to_the_model_and_fall_back_to_help(client, catalogue_ids, monkeypatch):
    asked = []

    def model(image, prompt, max_tokens, sleep, system):
        asked.append(prompt)
        return '{"topic": "approvals", "product": null, "days": null}'

    monkeypatch.setattr(extraction, "_ask_model", model)
    assert ask(client, "Anything for me to sign off?")["topic"] == "approvals"
    assert "Anything for me to sign off?" in asked[0]

    def down(*a, **k):
        raise extraction.ExtractionError("not set up")

    monkeypatch.setattr(extraction, "_ask_model", down)
    assert ask(client, "Tell me a joke")["topic"] == "help"


def test_a_topic_needs_the_section_its_records_belong_to(make_user, catalogue_ids):
    staff = make_user("staff")  # purchasing: none by default
    got = staff.post("/api/ask", json={"question": "What should we order?"}).json()
    assert got["topic"] == "help" and "access" in got["text"]
