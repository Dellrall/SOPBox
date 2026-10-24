"""Reading a supplier sheet into product suggestions, and adding reviewed products together."""

import pytest

from app import extraction
from app.errors import ExtractionError

SHEET_REPLY = """```json
{"products": [
  {"name": "Frozen Sausage 1kg", "category": "frozen", "base_unit": "pcs", "pack_unit": "ctn", "units_per_pack": 12,
   "temp_min_c": -20, "temp_max_c": -10, "sop": "Reject if thawed\\nStore at -18 C", "warning": null},
  {"name": "Fresh Milk 1L", "category": "Chilled", "base_unit": "bottle", "pack_unit": null, "units_per_pack": null,
   "temp_min_c": null, "temp_max_c": 4, "warning": ""}
]}
```"""


def test_suggestions_are_parsed_and_half_a_range_becomes_a_note():
    sausage, milk = [extraction.ProductSuggestion.model_validate(r) for r in extraction._rows(SHEET_REPLY, "products")]
    assert (sausage.pack_unit, sausage.units_per_pack, sausage.temp_min_c) == ("ctn", 12, -20)
    assert sausage.sop == "Reject if thawed\nStore at -18 C" and milk.sop is None
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


# Recorded from endpoint sriet0cftztbik (Qwen3-VL-8B) on 24 Oct 2026 for a three-product supplier
# list. Asked for units, the model takes them from the product name; the pack size it copies right.
LIVE_SHEET_REPLY = (
    '{"products": [{"name": "Chicken Nuggets 1kg", "category": "Frozen", "pack_size": "10 pcs/ctn", '
    '"base_unit": "1kg", "pack_unit": "ctn", "units_per_pack": 10, "temp_min_c": -20, "temp_max_c": -12, "warning": null}, '
    '{"name": "Fresh Milk 1L", "category": "Chilled", "pack_size": "12 bt/ctn", "base_unit": "1L", "pack_unit": "ctn", '
    '"units_per_pack": 12, "temp_min_c": 0, "temp_max_c": 4, "warning": null}, '
    '{"name": "Hot Dog Box", "category": "Dry", "pack_size": "500 pcs/bdl", "base_unit": "pcs", "pack_unit": "bdl", '
    '"units_per_pack": 500, "temp_min_c": null, "temp_max_c": null, "warning": null}]}'
)


def test_units_come_from_the_printed_pack_size_not_the_product_name(monkeypatch):
    monkeypatch.setattr(extraction, "_ask_model", lambda *a, **k: LIVE_SHEET_REPLY)
    nuggets, milk, box = extraction.extract_products("img")
    assert (nuggets.base_unit, nuggets.pack_unit, nuggets.units_per_pack) == ("pcs", "ctn", 10)
    assert (milk.base_unit, milk.pack_unit, milk.units_per_pack) == ("bt", "ctn", 12)
    assert (box.base_unit, box.pack_unit, box.units_per_pack) == ("pcs", "bdl", 500)
    assert (nuggets.temp_min_c, nuggets.temp_max_c, milk.temp_min_c, milk.temp_max_c) == (-20, -12, 0, 4)


@pytest.mark.parametrize("text", ["10 pcs per ctn", "10pcs/ctn", " 10 PCS / CTN "])
def test_pack_size_variants_are_understood(text):
    s = extraction.ProductSuggestion(name="X", pack_size=text, base_unit="kg")
    assert (s.units_per_pack, s.base_unit.lower(), s.pack_unit.lower()) == (10, "pcs", "ctn")


def test_a_pack_size_that_cannot_be_read_is_flagged_and_the_model_values_kept():
    s = extraction.ProductSuggestion(name="X", pack_size="12 x 1L", base_unit="btl", pack_unit="ctn", units_per_pack=12)
    assert (s.base_unit, s.units_per_pack) == ("btl", 12)
    assert s.warning == "check the pack size: 12 x 1L"
