"""Deterministic receiving rules. No AI here: the model reads, these rules decide."""

from datetime import date

from app.models import DeliveryLineIn, LineCheck, Product


def to_base_units(product: Product, quantity: int, unit: str) -> int:
    wanted = unit.strip().lower()
    if wanted == product.base_unit.lower():
        return quantity
    for pack in product.pack_units:
        if pack.unit.lower() == wanted:
            return quantity * pack.base_qty
    raise ValueError(f"unit '{unit}' is not defined for {product.name}")


def check_line(product: Product | None, line: DeliveryLineIn, today: date | None = None) -> LineCheck:
    """Check one received line. Any issue means a manager must decide."""
    if product is None:
        return LineCheck(passed=False, issues=["unrecognised product"])

    issues: list[str] = []
    received: int | None = None

    try:
        received = to_base_units(product, line.quantity, line.unit)
    except ValueError as err:
        issues.append(str(err))

    if (
        received is not None
        and line.expected_base_qty is not None
        and received != line.expected_base_qty
    ):
        issues.append(f"received {received} {product.base_unit}, expected {line.expected_base_qty}")

    low, high = product.effective_temp_min_c, product.effective_temp_max_c
    if low is not None and high is not None:
        if line.temp_c is None:
            issues.append("temperature missing")
        elif not low <= line.temp_c <= high:
            issues.append(f"temperature {line.temp_c:g} C outside {low:g} to {high:g} C")

    if product.track_expiry:
        if line.expiry_on is None:
            if not line.expiry_later:
                issues.append("expiry date missing")
        else:
            days = (line.expiry_on - (today or date.today())).days
            if days < 0:
                issues.append(f"expired on {line.expiry_on:%d %b %Y}")
            elif product.min_days_left is not None and days < product.min_days_left:
                issues.append(f"only {days} day(s) before expiry, needs at least {product.min_days_left}")

    return LineCheck(passed=not issues, issues=issues, received_base_qty=received)
