"""Starter task: score extracted lines against labelled ones so the two models can be compared."""

import pytest
from score import score_lines

pytestmark = pytest.mark.xfail(raises=NotImplementedError, reason="TODO: implement score_lines", strict=True)

SAUSAGE = {"name": "Frozen sausage", "quantity": 2, "unit": "bdl"}
FRIES = {"name": "Fries tray", "quantity": 10, "unit": "pcs"}


def test_a_perfect_reading_scores_one():
    result = score_lines([SAUSAGE, FRIES], [FRIES, SAUSAGE])
    assert result == {"expected": 2, "matched": 2, "extra": 0, "accuracy": 1.0}


def test_a_wrong_quantity_is_not_a_match():
    result = score_lines([SAUSAGE, FRIES], [SAUSAGE, {**FRIES, "quantity": 12}])
    assert (result["matched"], result["extra"], result["accuracy"]) == (1, 1, 0.5)


def test_names_match_ignoring_case():
    assert score_lines([SAUSAGE], [{**SAUSAGE, "name": "FROZEN SAUSAGE"}])["matched"] == 1
