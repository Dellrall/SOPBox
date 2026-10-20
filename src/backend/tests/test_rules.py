from app.catalogue import CATALOGUE
from app.models import ReceivedLine
from app.rules import check_delivery, check_line, to_base_units

SAUSAGE = CATALOGUE["frozen-sausage"]
FRIES = CATALOGUE["fries-tray"]


def test_temperature_inside_range_passes():
    line = ReceivedLine(product_id="frozen-sausage", quantity=40, unit="pcs", temp_c=-15)
    check = check_line(SAUSAGE, line)
    assert check.passed
    assert check.issues == []


def test_temperature_outside_range_fails():
    line = ReceivedLine(product_id="frozen-sausage", quantity=40, unit="pcs", temp_c=-5)
    check = check_line(SAUSAGE, line)
    assert not check.passed
    assert "outside" in check.issues[0]


def test_missing_temperature_fails_when_range_is_set():
    line = ReceivedLine(product_id="frozen-sausage", quantity=40, unit="pcs")
    check = check_line(SAUSAGE, line)
    assert not check.passed
    assert "temperature missing" in check.issues


def test_bundles_convert_to_base_units():
    assert to_base_units(FRIES, 2, "bdl") == 500


def test_quantity_matching_expected_passes():
    line = ReceivedLine(product_id="fries-tray", quantity=2, unit="bdl", expected_base_qty=500)
    check = check_line(FRIES, line)
    assert check.passed
    assert check.received_base_qty == 500


def test_quantity_mismatch_fails():
    line = ReceivedLine(product_id="fries-tray", quantity=2, unit="bdl", expected_base_qty=400)
    check = check_line(FRIES, line)
    assert not check.passed


def test_unknown_unit_fails():
    line = ReceivedLine(product_id="fries-tray", quantity=2, unit="box")
    check = check_line(FRIES, line)
    assert not check.passed
    assert check.received_base_qty is None


def test_unknown_product_fails():
    checks = check_delivery(CATALOGUE, [ReceivedLine(product_id="coke", quantity=1, unit="pcs")])
    assert not checks[0].passed
    assert checks[0].issues == ["unknown product"]
