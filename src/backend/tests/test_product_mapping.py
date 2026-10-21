
from app.models import ExtractedLine
from app.product_mapping import (
    map_extracted_line,
    map_product_name,
    normalize_product_name,
)


def test_normalize_product_name():
    assert normalize_product_name("  FROZEN   Sausage ") == "frozen sausage"


def test_exact_product_name_maps_to_catalogue():
    product = map_product_name("Frozen sausage")

    assert product is not None
    assert product.id == "frozen-sausage"


def test_product_matching_ignores_case_and_extra_spaces():
    product = map_product_name("  FROZEN   SAUSAGE ")

    assert product is not None
    assert product.id == "frozen-sausage"


def test_unknown_product_does_not_get_guessed():
    product = map_product_name("Unknown seafood")

    assert product is None


def test_matched_extracted_line_returns_product_id():
    line = ExtractedLine(
        name="Fries tray",
        quantity=2,
        unit="bdl",
    )

    result = map_extracted_line(line)

    assert result["product_id"] == "fries-tray"
    assert result["needs_confirmation"] is False
    assert result["quantity"] == 2
    assert result["unit"] == "bdl"


def test_unmatched_extracted_line_needs_confirmation():
    line = ExtractedLine(
        name="Unknown seafood",
        quantity=3,
        unit="box",
    )

    result = map_extracted_line(line)

    assert result["product_id"] is None
    assert result["needs_confirmation"] is True
    assert result["name"] == "Unknown seafood"
