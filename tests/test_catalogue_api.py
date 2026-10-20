"""Categories, products, SOP search, and matching order text to products."""

import pytest


def product_body(ids, **overrides):
    body = {"name": "Chocolate ball", "category_id": ids["packaging_category"], "base_unit": "pcs"}
    return {**body, **overrides}


# ---- categories -------------------------------------------------------------------------------


def test_category_create_edit_delete(client, manager):
    created = client.post(
        "/api/categories",
        json={"name": "Dessert", "temp_min_c": -10, "temp_max_c": 0},
        headers=manager,
    )
    assert created.status_code == 201
    category_id = created.json()["id"]

    edited = client.put(
        f"/api/categories/{category_id}",
        json={"name": "Frozen dessert", "temp_min_c": -12, "temp_max_c": -2},
        headers=manager,
    )
    assert edited.json()["name"] == "Frozen dessert"
    assert edited.json()["temp_min_c"] == -12

    assert client.delete(f"/api/categories/{category_id}", headers=manager).status_code == 204
    assert client.get("/api/categories").json() == []
    assert client.delete(f"/api/categories/{category_id}", headers=manager).status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"name": "Frozen", "temp_min_c": -20},  # only one end of the range
        {"name": "Frozen", "temp_min_c": 5, "temp_max_c": -5},  # min above max
        {"name": "   "},  # blank name
    ],
)
def test_category_rejects_invalid_input(client, manager, body):
    assert client.post("/api/categories", json=body, headers=manager).status_code == 422


def test_category_names_are_unique_ignoring_case(client, manager):
    client.post("/api/categories", json={"name": "Frozen"}, headers=manager)
    dup = client.post("/api/categories", json={"name": "frozen"}, headers=manager)
    assert dup.status_code == 409


def test_category_with_products_cannot_be_deleted(client, manager, catalogue_ids):
    resp = client.delete(f"/api/categories/{catalogue_ids['frozen_category']}", headers=manager)
    assert resp.status_code == 409


# ---- products ---------------------------------------------------------------------------------


def test_product_inherits_the_category_range(client, catalogue_ids):
    product = client.get(f"/api/products/{catalogue_ids['sausage']}").json()
    assert product["temp_min_c"] is None
    assert (product["effective_temp_min_c"], product["effective_temp_max_c"]) == (-20, -10)
    assert product["category"] == "Frozen"


def test_product_range_overrides_the_category(client, manager, catalogue_ids):
    body = product_body(
        catalogue_ids, category_id=catalogue_ids["frozen_category"], temp_min_c=-30, temp_max_c=-25
    )
    product = client.post("/api/products", json=body, headers=manager).json()
    assert (product["effective_temp_min_c"], product["effective_temp_max_c"]) == (-30, -25)


def test_product_without_any_range_has_no_temperature_check(client, catalogue_ids):
    fries = client.get(f"/api/products/{catalogue_ids['fries']}").json()
    assert fries["effective_temp_min_c"] is None
    assert fries["pack_units"] == [{"unit": "bdl", "base_qty": 250}]


def test_update_replaces_pack_units_and_keeps_stock(client, manager, catalogue_ids):
    fries_id = catalogue_ids["fries"]
    body = product_body(
        catalogue_ids,
        name="Fries tray",
        pack_units=[{"unit": "carton", "base_qty": 500}],
    )
    updated = client.put(f"/api/products/{fries_id}", json=body, headers=manager).json()
    assert updated["pack_units"] == [{"unit": "carton", "base_qty": 500}]
    assert updated["stock"] == 0


def test_product_rejects_a_pack_unit_that_repeats_the_base_unit(client, manager, catalogue_ids):
    body = product_body(catalogue_ids, pack_units=[{"unit": "PCS", "base_qty": 10}])
    assert client.post("/api/products", json=body, headers=manager).status_code == 422


def test_product_rejects_an_unknown_category(client, manager, catalogue_ids):
    body = product_body(catalogue_ids, category_id=9999)
    assert client.post("/api/products", json=body, headers=manager).status_code == 422


def test_product_names_are_unique_ignoring_case(client, manager, catalogue_ids):
    body = product_body(catalogue_ids, name="FROZEN SAUSAGE")
    assert client.post("/api/products", json=body, headers=manager).status_code == 409


def test_unknown_product_is_404(client, manager, catalogue_ids):
    assert client.get("/api/products/9999").status_code == 404
    body = product_body(catalogue_ids)
    assert client.put("/api/products/9999", json=body, headers=manager).status_code == 404
    assert client.delete("/api/products/9999", headers=manager).status_code == 404


def test_product_delete(client, manager, catalogue_ids):
    fries_id = catalogue_ids["fries"]
    assert client.delete(f"/api/products/{fries_id}", headers=manager).status_code == 204
    assert client.get(f"/api/products/{fries_id}").status_code == 404


def test_product_on_a_delivery_cannot_be_deleted(client, manager, catalogue_ids):
    sausage_id = catalogue_ids["sausage"]
    delivery = {
        "received_by": "Aina",
        "lines": [
            {"product_id": sausage_id, "name": "Frozen sausage", "quantity": 5, "unit": "pcs", "temp_c": -15}
        ],
    }
    assert client.post("/api/deliveries", json=delivery).status_code == 201
    assert client.delete(f"/api/products/{sausage_id}", headers=manager).status_code == 409


def test_low_stock_flag_follows_the_minimum(client, catalogue_ids):
    sausage = client.get(f"/api/products/{catalogue_ids['sausage']}").json()
    assert sausage["min_stock"] == 50 and sausage["stock"] == 0
    assert sausage["low_stock"] is True
    # No minimum set means never flagged.
    assert client.get(f"/api/products/{catalogue_ids['fries']}").json()["low_stock"] is False


# ---- SOP search -------------------------------------------------------------------------------


def test_search_matches_name_category_and_sop_text(client, manager, catalogue_ids):
    body = product_body(
        catalogue_ids, name="Cooking oil", sop="Check no bottle is leaking before signing."
    )
    client.post("/api/products", json=body, headers=manager)

    def names(q):
        return [p["name"] for p in client.get("/api/products", params={"q": q}).json()]

    assert names("sausage") == ["Frozen sausage"]
    assert names("leaking") == ["Cooking oil"]
    assert names("frozen") == ["Frozen sausage"]  # by category
    assert names("nothing like this") == []
    assert len(names("")) == 3


def test_search_treats_percent_as_a_literal_character(client, catalogue_ids):
    assert client.get("/api/products", params={"q": "%"}).json() == []


# ---- matching order text to products ----------------------------------------------------------


def test_extract_matches_lines_to_catalogue_products(client, catalogue_ids, monkeypatch):
    from app import main
    from app.models import ExtractedLine

    monkeypatch.setattr(
        main,
        "extract_lines",
        lambda _: [
            ExtractedLine(name="fries tray", quantity=2, unit="bdl"),
            ExtractedLine(name="FRIES TRAY (large)", quantity=1, unit="bdl"),
            ExtractedLine(name="Frozen   Sausage", quantity=40, unit="pcs"),
            ExtractedLine(name="Mystery item", quantity=3, unit="box"),
            ExtractedLine(name="Sausage rolls", quantity=3, unit="box"),
        ],
    )
    resp = client.post("/api/extract", json={"image_b64": "ZmFrZQ=="})
    matched = [line["product_id"] for line in resp.json()]
    assert matched == [
        catalogue_ids["fries"],  # exact, ignoring case
        catalogue_ids["fries"],  # catalogue name appears as whole words in the line
        catalogue_ids["sausage"],  # exact after collapsing spaces
        None,  # nothing close
        None,  # shares a word with a product but is not that product
    ]
