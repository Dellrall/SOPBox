from app.models import LineCheck, Product, ReceivedLine


def to_base_units(product: Product, quantity: int, unit: str) -> int:
    if unit == product.base_unit:
        return quantity
    for pack in product.pack_units:
        if pack.unit == unit:
            return quantity * pack.base_qty
    raise ValueError(f"unknown unit '{unit}' for {product.name}")


def check_line(product: Product, line: ReceivedLine) -> LineCheck:
    issues: list[str] = []
    received = None

    try:
        received = to_base_units(product, line.quantity, line.unit)
    except ValueError as err:
        issues.append(str(err))

    if received is not None and line.expected_base_qty is not None and received != line.expected_base_qty:
        issues.append(f"received {received} {product.base_unit}, expected {line.expected_base_qty}")

    if product.temp_min_c is not None and product.temp_max_c is not None:
        if line.temp_c is None:
            issues.append("temperature missing")
        elif not product.temp_min_c <= line.temp_c <= product.temp_max_c:
            issues.append(
                f"temperature {line.temp_c} C outside {product.temp_min_c} to {product.temp_max_c} C"
            )

    return LineCheck(product_id=product.id, passed=not issues, issues=issues, received_base_qty=received)


def check_delivery(catalogue: dict[str, Product], lines: list[ReceivedLine]) -> list[LineCheck]:
    checks: list[LineCheck] = []
    for line in lines:
        product = catalogue.get(line.product_id)
        if product is None:
            checks.append(
                LineCheck(product_id=line.product_id, passed=False, issues=["unknown product"])
            )
        else:
            checks.append(check_line(product, line))
    return checks
