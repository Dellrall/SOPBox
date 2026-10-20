from pydantic import BaseModel, Field


class PackUnit(BaseModel):
    unit: str
    base_qty: int = Field(gt=0)


class Product(BaseModel):
    id: str
    name: str
    category: str
    base_unit: str
    temp_min_c: float | None = None
    temp_max_c: float | None = None
    pack_units: list[PackUnit] = []


class ExtractedLine(BaseModel):
    name: str
    quantity: int = Field(gt=0)
    unit: str


class ReceivedLine(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)
    unit: str
    temp_c: float | None = None
    expected_base_qty: int | None = None


class LineCheck(BaseModel):
    product_id: str
    passed: bool
    issues: list[str]
    received_base_qty: int | None = None
