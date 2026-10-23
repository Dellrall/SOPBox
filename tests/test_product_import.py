"""Reading a supplier sheet into product suggestions, and adding reviewed products together."""

import pytest

from app import extraction
from app.errors import ExtractionError

SHEET_REPLY = """```json
{"products": [
  {"name": "Frozen Sausage 1kg", "category": "frozen", "base_unit": "pcs", "pack_unit": "ctn", "units_per_pack": 12,
   "temp_min_c": -20, "temp_max_c": -10, "warning": null},
  {"name": "Fresh Milk 1L", "category": "Chilled", "base_unit": "bottle", "pack_unit": null, "units_per_pack": null,
   "temp_min_c": null, "temp_max_c": 4, "warning": ""}
]}
```"""


def test_suggestions_are_parsed_and_half_a_range_becomes_a_note():
    sausage, milk = [extraction.ProductSuggestion.model_validate(r) for r in extraction._rows(SHEET_REPLY, "products")]
    assert (sausage.pack_unit, sausage.units_per_pack, sausage.temp_min_c) == ("ctn", 12, -20)
    assert (milk.temp_min_c, milk.temp_max_c) == (None, None)
    assert milk.warning == "only one temperature was printed (4.0 C)"


def test_a_suggestion_without_a_name_rejects_the_reply(monkeypatch):
    monkeypatch.setattr(extraction, "_ask_model", lambda *a, **k: '{"products": [{"name": ""}]}')
    with pytest.raises(ExtractionError):
        extraction.extract_products("img")


def test_reading_a_sheet_matches_categories_and_flags_existing_products(client, catalogue_ids, monkeypatch):
    monkeypatch.setattr(extraction, "_ask_model", lambda *a, **k: SHEET_REPLY)
    monkeypatch.setattr("app.main.extract_products", extraction.extract_products)
    resp = client.post("/api/products/read-sheet", json={"image_b64": "aW1n"})
    assert resp.status_code == 200, resp.text
    sausage, milk = resp.json()
    # "frozen" matches the existing Frozen category, ignoring case. Nothing was saved.
    assert sausage["category_id"] == catalogue_ids["frozen_category"]
    assert milk["category_id"] is None
    assert sausage["exists"] is False
    assert len(client.get("/api/products").json()) == 2


def test_staff_cannot_read_sheets_or_bulk_add(client, make_user):
    staff = make_user("staff")
    assert staff.post("/api/products/read-sheet", json={"image_b64": "aW1n"}).status_code == 403
    assert staff.post("/api/products/bulk", json={"products": []}).status_code == 403


def test_bulk_add_creates_every_product(client, catalogue_ids):
    body = {
        "products": [
            {"name": "Nuggets", "category_id": catalogue_ids["frozen_category"], "base_unit": "pcs",
             "pack_units": [{"unit": "ctn", "base_qty": 12}]},
            {"name": "Hot dog box", "category_id": catalogue_ids["packaging_category"], "base_unit": "pcs"},
        ]
    }
    resp = client.post("/api/products/bulk", json=body)
    assert resp.status_code == 201, resp.text
    assert [p["name"] for p in resp.json()] == ["Nuggets", "Hot dog box"]


def test_bulk_add_keeps_nothing_when_one_product_is_refused(client, catalogue_ids):
    before = len(client.get("/api/products").json())
    body = {
        "products": [
            {"name": "Nuggets", "category_id": catalogue_ids["frozen_category"], "base_unit": "pcs"},
            {"name": "Frozen sausage", "category_id": catalogue_ids["frozen_category"], "base_unit": "pcs"},
        ]
    }
    resp = client.post("/api/products/bulk", json=body)
    assert resp.status_code == 409
    assert "already a product with that name" in resp.json()["detail"]
    assert len(client.get("/api/products").json()) == before
