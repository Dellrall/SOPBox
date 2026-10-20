from app.models import PackUnit, Product

# Seed data from the brief. In-memory for now; move to PostgreSQL once the schema is agreed.
_PRODUCTS = [
    Product(
        id="frozen-sausage",
        name="Frozen sausage",
        category="Frozen",
        base_unit="pcs",
        temp_min_c=-20,
        temp_max_c=-10,
    ),
    Product(
        id="chocolate-ball",
        name="Chocolate ball",
        category="Dessert",
        base_unit="pcs",
        temp_min_c=-10,
        temp_max_c=0,
    ),
    Product(
        id="fries-tray",
        name="Fries tray",
        category="Sides",
        base_unit="pcs",
        pack_units=[PackUnit(unit="bdl", base_qty=250)],
    ),
    Product(
        id="hot-dog-box",
        name="Hot dog box",
        category="Buns",
        base_unit="pcs",
        pack_units=[PackUnit(unit="bdl", base_qty=100)],
    ),
    Product(
        id="nugget",
        name="Nugget",
        category="Frozen",
        base_unit="packet",
        pack_units=[PackUnit(unit="box", base_qty=12)],
    ),
]

CATALOGUE: dict[str, Product] = {p.id: p for p in _PRODUCTS}
