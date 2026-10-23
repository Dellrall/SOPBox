"""Demo catalogue, loaded once when the database is empty.

Temperature ranges, pack sizes and units marked "brief" come from the hackathon brief. Everything
marked "placeholder" is invented so the demo has ten products: the Data owner replaces it with
the store's real items. Stock and minimum values are demo numbers.
"""

import sqlite3

from app import catalogue
from app.models import CategoryIn, PackUnit, ProductIn

_CATEGORIES = [
    ("Frozen", -20, -10),  # brief: frozen sausage arrives at -20 C to -10 C
    ("Dessert", -10, 0),  # brief: chocolate ball arrives at -10 C to 0 C
    ("Packaging", None, None),
    ("Beverage", None, None),
    ("Dry goods", None, None),
]

_ARRIVAL = (
    "Probe the temperature on arrival and enter it. If it is outside {range}, do not accept the "
    "item yourself: record the reading and wait for the manager's decision. "
)

# (name, category, base unit, pack units, min stock, demo stock, sop)
_PRODUCTS = [
    (
        "Frozen sausage",  # brief
        "Frozen", "pcs", [], 100, 120,
        _ARRIVAL.format(range="-20 to -10 C") + "Check the packs are sealed and frozen solid.",
    ),
    (
        "Chocolate ball",  # brief
        "Dessert", "pcs", [], 60, 80,
        _ARRIVAL.format(range="-10 to 0 C") + "Check for melted or re-frozen product.",
    ),
    (
        "Nugget",  # brief: 12 packets per box
        "Frozen", "packet", [PackUnit(unit="box", base_qty=12)], 24, 6,
        _ARRIVAL.format(range="-20 to -10 C") + "Count boxes. 1 box = 12 packets.",
    ),
    (
        "Fries tray",  # brief: 250 pcs per bundle
        "Packaging", "pcs", [PackUnit(unit="bdl", base_qty=250)], 500, 750,
        "Count bundles, not single trays. 1 bundle = 250 pcs. Check the bundles are dry and undamaged.",
    ),
    (
        "Hot dog box",  # brief: 100 pcs per bundle
        "Packaging", "pcs", [PackUnit(unit="bdl", base_qty=100)], 200, 150,
        "Count bundles. 1 bundle = 100 pcs. Check the bundles are dry and undamaged.",
    ),
    (
        "Coke",  # brief gives "8 oz (4.5 kg) / box", which mixes units. Counted in boxes until agreed.
        "Beverage", "box", [], 5, 10,
        "Count boxes. The pack conversion is not confirmed yet, so stock is kept in boxes.",
    ),
    # Placeholders from here on.
    (
        "Frozen chicken patty",
        "Frozen", "packet", [PackUnit(unit="box", base_qty=10)], 20, 40,
        _ARRIVAL.format(range="-20 to -10 C") + "Count boxes. 1 box = 10 packets (placeholder).",
    ),
    (
        "Frozen fries",
        "Frozen", "packet", [PackUnit(unit="box", base_qty=8)], 16, 30,
        _ARRIVAL.format(range="-20 to -10 C") + "Count boxes. 1 box = 8 packets (placeholder).",
    ),
    (
        "Paper cup",
        "Packaging", "pcs", [PackUnit(unit="bdl", base_qty=50)], 200, 400,
        "Count bundles. 1 bundle = 50 pcs (placeholder).",
    ),
    (
        "Cooking oil",
        "Dry goods", "bottle", [PackUnit(unit="carton", base_qty=4)], 8, 12,
        "Count cartons. 1 carton = 4 bottles (placeholder). Check no bottle is leaking.",
    ),
]


def seed_if_empty(conn: sqlite3.Connection) -> bool:
    """Load the demo catalogue into an empty database. Returns True if it loaded anything."""
    if conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0] > 0:
        return False
    category_ids = {
        name: catalogue.create_category(conn, CategoryIn(name=name, temp_min_c=low, temp_max_c=high)).id
        for name, low, high in _CATEGORIES
    }
    for name, category, base_unit, packs, min_stock, stock, sop in _PRODUCTS:
        catalogue.create_product(
            conn,
            ProductIn(
                name=name,
                category_id=category_ids[category],
                base_unit=base_unit,
                min_stock=min_stock,
                sop=sop,
                pack_units=packs,
            ),
            stock=stock,
        )
    return True
