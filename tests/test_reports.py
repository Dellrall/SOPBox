"""Reports: every kind runs over the outlet worked in, filters narrow it, totals are worked out in code."""

from datetime import date

from test_locations import _count, _storages

KINDS = ["deliveries", "spend", "suppliers", "orders", "sales", "sales_by_product", "counts", "transfers", "waste",
         "stock", "movement", "expiry"]


def _deliver(client, product_id, supplier, quantity, price):
    resp = client.post("/api/deliveries", json={"supplier": supplier, "lines": [
        {"product_id": product_id, "name": "Fries tray", "quantity": quantity, "unit": "pcs", "unit_price_sen": price}]})
    assert resp.status_code == 201, resp.text


def _report(client, kind, **filters):
    resp = client.get(f"/api/reports/{kind}", params={k: v for k, v in filters.items() if v is not None})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_reports_filter_by_supplier_product_and_period_with_totals_in_code(client, catalogue_ids):
    fries, sausage = catalogue_ids["fries"], catalogue_ids["sausage"]
    _deliver(client, fries, "Fresh Mart", 10, 50)
    _deliver(client, fries, "Fresh Mart", 5, 60)
    _deliver(client, fries, "Other Co", 2, 40)
    store = _storages(client)["Main outlet / Store"]
    _count(client, store, fries, 17, 15)  # 2 missing
    sale = client.post("/api/sales", json={"storage_id": store, "sale_date": date.today().isoformat(),
                                           "lines": [{"product_id": fries, "quantity": 3}]})
    assert sale.status_code == 201, sale.text

    for kind in KINDS:  # every report runs, empty or not
        _report(client, kind)

    lines = _report(client, "deliveries", supplier="fresh mart")
    assert [r["quantity"] for r in lines["rows"]] == [5, 10] and lines["totals"]["value"] == 5 * 60 + 10 * 50
    spend = _report(client, "spend")
    fresh = next(r for r in spend["rows"] if r["supplier"] == "Fresh Mart")
    assert (fresh["deliveries"], fresh["received"], fresh["value"]) == (2, 15, 800)
    assert spend["totals"]["value"] == 880
    assert _report(client, "deliveries", product_id=sausage)["rows"] == []
    assert _report(client, "deliveries", date_to="2000-01-01")["rows"] == []

    counts = _report(client, "counts", product_id=fries)
    assert counts["rows"][0]["difference"] == -2 and counts["rows"][0]["value"] == -80  # at the latest price, 40 sen
    movement = next(r for r in _report(client, "movement")["rows"] if r["product"] == "Fries tray")
    assert (movement["received"], movement["sold"], movement["count_change"], movement["net"]) == (17, 3, -2, 12)
    assert _report(client, "sales_by_product")["totals"]["sold"] == 3
    assert next(r for r in _report(client, "stock")["rows"] if r["product"] == "Fries tray")["quantity"] == 12

    bad = client.get("/api/reports/deliveries", params={"date_from": "2026-02-01", "date_to": "2026-01-01"})
    assert bad.status_code == 422 and "period" in bad.text
    assert client.get("/api/reports/nonsense").status_code == 422


def test_staff_cannot_read_reports(client, make_user):
    staff = make_user("staff")
    assert staff.get("/api/reports/deliveries").status_code == 403
