"""Receiving rules. Pure functions: no database and no API."""

import pytest

from app.models import DeliveryLineIn, PackUnit, Product
from app.rules import check_line, to_base_units


def make_product(**overrides) -> Product:
    fields = dict(
        id=1,
        name="Frozen sausage",
        category_id=1,
        category="Frozen",
        base_unit="pcs",
        temp_min_c=None,
        temp_max_c=None,
        effective_temp_min_c=-20,
        effective_temp_max_c=-10,
        min_stock=0,
        stock=0,
        sop="",
        pack_units=[PackUnit(unit="bdl", base_qty=250)],
        low_stock=False,
    )
    return Product(**{**fields, **overrides})


def make_line(**overrides) -> DeliveryLineIn:
    fields = dict(product_id=1, name="Frozen sausage", quantity=40, unit="pcs", temp_c=-15)
    return DeliveryLineIn(**{**fields, **overrides})


def test_temperature_inside_range_passes():
    check = check_line(make_product(), make_line(temp_c=-15))
    assert check.passed
    assert check.issues == []


@pytest.mark.parametrize("temp", [-20, -10])
def test_range_limits_are_inclusive(temp):
    assert check_line(make_product(), make_line(temp_c=temp)).passed


@pytest.mark.parametrize("temp", [-20.1, -9.9, -5, 4])
def test_temperature_outside_range_fails(temp):
    check = check_line(make_product(), make_line(temp_c=temp))
    assert not check.passed
    assert "outside -20 to -10 C" in check.issues[0]


def test_missing_temperature_fails_when_a_range_applies():
    check = check_line(make_product(), make_line(temp_c=None))
    assert not check.passed
    assert check.issues == ["temperature missing"]


def test_temperature_is_ignored_when_no_range_applies():
    product = make_product(effective_temp_min_c=None, effective_temp_max_c=None)
    assert check_line(product, make_line(temp_c=None)).passed
    assert check_line(product, make_line(temp_c=30)).passed


def test_bundles_convert_to_base_units():
    assert to_base_units(make_product(), 2, "bdl") == 500
    assert to_base_units(make_product(), 7, "pcs") == 7


def test_unit_match_ignores_case_and_spaces():
    assert to_base_units(make_product(), 2, " BDL ") == 500


def test_quantity_matching_expected_passes():
    line = make_line(quantity=2, unit="bdl", expected_base_qty=500)
    check = check_line(make_product(effective_temp_min_c=None, effective_temp_max_c=None), line)
    assert check.passed
    assert check.received_base_qty == 500


def test_quantity_mismatch_fails_and_says_why():
    line = make_line(quantity=2, unit="bdl", expected_base_qty=400, temp_c=-15)
    check = check_line(make_product(), line)
    assert not check.passed
    assert check.issues == ["received 500 pcs, expected 400"]


def test_unknown_unit_fails_with_no_base_quantity():
    check = check_line(make_product(), make_line(unit="box"))
    assert not check.passed
    assert check.received_base_qty is None
    assert "not defined" in check.issues[0]


def test_every_problem_is_reported_not_just_the_first():
    line = make_line(quantity=2, unit="bdl", expected_base_qty=400, temp_c=-5)
    assert len(check_line(make_product(), line).issues) == 2


def test_unrecognised_product_fails():
    check = check_line(None, make_line(product_id=None))
    assert not check.passed
    assert check.issues == ["unrecognised product"]
    assert check.received_base_qty is None
