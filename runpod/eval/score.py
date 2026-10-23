"""Scores a model's extracted lines against hand-labelled lines (the Wed 21 Oct model test)."""


def score_lines(expected: list[dict], got: list[dict]) -> dict:
    """Compare lines by (name ignoring case, quantity, unit).

    Returns {"expected": int, "matched": int, "extra": int, "accuracy": float}, where accuracy is
    matched / expected (1.0 when there is nothing to expect and nothing extra).
    """
    raise NotImplementedError("TODO: implement score_lines")
