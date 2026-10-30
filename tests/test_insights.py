"""Count gaps with their history, the model's reading of them, and reorder amounts from recent use."""

from datetime import date, timedelta

from app import extraction

TODAY = date.today()


def count(client, product_id, expected, counted, day=TODAY):
    resp = client.post(
        "/api/stocktakes",
        json={
            "count_date": day.isoformat(),
            "lines": [{"product_id": product_id, "expected_stock": expected, "counted_stock": counted}],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_a_gap_short_at_earlier_counts_is_a_repeat(client, catalogue_ids):
    fries = catalogue_ids["fries"]
    first = count(client, fries, 0, 20)
    for expected, counted in ((20, 18), (18, 15)):
        count(client, fries, expected, counted)
    third = count(client, fries, 15, 12)

    got = client.get(f"/api/stocktakes/{third}/insights").json()
    [gap] = got["gaps"]
    assert (gap["product_name"], gap["difference"], gap["share"]) == ("Fries tray", -3, -0.2)
    assert gap["earlier"] == [-3, -2, 20]
    assert gap["pattern"] == "repeat"
    assert "2 of the last 3" in gap["hint"]

    over = client.get(f"/api/stocktakes/{first}/insights").json()["gaps"][0]
    assert over["pattern"] == "over" and over["share"] is None and over["earlier"] == []


def test_a_one_off_gap_without_sales_says_use_shows_as_a_gap(client, catalogue_ids):
    fries = catalogue_ids["fries"]
    count(client, fries, 0, 10)
    st = count(client, fries, 10, 7)
    got = client.get(f"/api/stocktakes/{st}/insights").json()
    assert got["sales_recorded"] is False
    assert got["gaps"][0]["pattern"] == "one_off"
    assert "No sales are recorded" in got["gaps"][0]["hint"]
    assert client.get("/api/stocktakes/999999/insights").status_code == 404


def test_the_model_explains_the_gaps_from_the_numbers(client, catalogue_ids, monkeypatch):
    fries = catalogue_ids["fries"]
    count(client, fries, 0, 10)
    st = count(client, fries, 10, 7)
    asked = []

    def ask(image, prompt, max_tokens, sleep, system):
        asked.append(prompt)
        return '{"summary": "Fries tray is 3 pcs short.", "actions": ["Check the bin log", " ", "Upload sales"]}'

    monkeypatch.setattr(extraction, "_ask_model", ask)
    resp = client.post(f"/api/stocktakes/{st}/explain")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"summary": "Fries tray is 3 pcs short.", "actions": ["Check the bin log", "Upload sales"]}
    assert '"difference": -3' in asked[0] and '"sales_recorded": false' in asked[0]


def test_a_reply_in_the_wrong_shape_is_a_502_and_a_matched_count_has_nothing_to_explain(client, catalogue_ids, monkeypatch):
    fries = catalogue_ids["fries"]
    count(client, fries, 0, 10)
    short = count(client, fries, 10, 7)
    matched = count(client, fries, 7, 7)
    monkeypatch.setattr(extraction, "_ask_model", lambda *a, **k: '{"actions": []}')
    assert client.post(f"/api/stocktakes/{short}/explain").status_code == 502
    resp = client.post(f"/api/stocktakes/{matched}/explain")
    assert resp.status_code == 422 and "every product matched" in resp.json()["detail"]


def test_reorder_covers_a_week_of_recent_use_and_the_minimum(client, catalogue_ids):
    ids = catalogue_ids
    # Fries: 100 counted before the window, 30 left today, so 70 used; a record younger than a
    # week is spread over 7 days: 10 a day, and a week's worth is 70.
    count(client, ids["fries"], 0, 100, TODAY - timedelta(days=40))
    count(client, ids["fries"], 100, 30)

    got = {s["product_name"]: s for s in client.get("/api/purchase-orders/reorder-suggestions").json()}
    fries, sausage = got["Fries tray"], got["Frozen sausage"]
    assert (fries["daily_use"], fries["days_left"], fries["quantity"]) == (10, 3, 40)
    assert fries["reason"].startswith("Uses about 10 pcs a day; 30 pcs lasts about 3 days.")
    assert (sausage["quantity"], sausage["reason"]) == (50, "Below its minimum of 50 pcs.")

    supplier = client.post("/api/suppliers", json={"name": "Fresh Mart"}).json()
    draft = client.post("/api/purchase-orders/low-stock-draft", json={"supplier_id": supplier["id"]})
    assert draft.status_code == 201, draft.text
    assert sorted((l["product_name"], l["quantity"]) for l in draft.json()["lines"]) == [("Fries tray", 40), ("Frozen sausage", 50)]
    # Now on order, so nothing is left to order but each product still says what covers it.
    after = client.get("/api/purchase-orders/reorder-suggestions").json()
    assert [s["quantity"] for s in after] == [0, 0]
    assert all("already on order" in s["reason"] for s in after)


def test_staff_without_purchasing_cannot_see_suggestions(make_user, catalogue_ids):
    staff = make_user("staff")
    assert staff.get("/api/purchase-orders/reorder-suggestions").status_code == 403
