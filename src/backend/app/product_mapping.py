
import re

from app.catalogue import CATALOGUE
from app.models import ExtractedLine, Product


def normalize_product_name(name: str) -> str:
    """Normalize whitespace and letter case for safe exact-name matching."""
    return re.sub(r"\s+", " ", name).strip().casefold()


def map_product_name(name: str) -> Product | None:
    """
    Match an extracted product name to the existing catalogue.

    Returns None when there is no exact normalized name match.
    Does not guess or use fuzzy matching.
    """
    normalized_name = normalize_product_name(name)

    if not normalized_name:
        return None

    matches = [
        product
        for product in CATALOGUE.values()
        if normalize_product_name(product.name) == normalized_name
    ]

    if len(matches) != 1:
        return None

    return matches[0]


def map_extracted_line(line: ExtractedLine) -> dict:
    """
    Map an extracted line to a product ID when its name matches exactly.

    This does not confirm quantity, temperature, or expected stock.
    """
    product = map_product_name(line.name)

    if product is None:
        return {
            "name": line.name,
            "quantity": line.quantity,
            "unit": line.unit,
            "product_id": None,
            "needs_confirmation": True,
        }

    return {
        "name": line.name,
        "quantity": line.quantity,
        "unit": line.unit,
        "product_id": product.id,
        "needs_confirmation": False,
    }
