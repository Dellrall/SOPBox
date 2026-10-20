from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

DeliveryStatus = Literal["accepted", "pending_approval", "rejected", "returned"]


def _check_range(low: float | None, high: float | None) -> None:
    if (low is None) != (high is None):
        raise ValueError("set both temp_min_c and temp_max_c, or neither")
    if low is not None and high is not None and low > high:
        raise ValueError("temp_min_c must not be above temp_max_c")


class _In(BaseModel):
    """Base for request bodies: strip whitespace before length checks."""

    model_config = ConfigDict(str_strip_whitespace=True)


class CategoryIn(_In):
    name: str = Field(min_length=1, max_length=80)
    # Default receiving temperature range for every product in the category (inclusive).
    temp_min_c: float | None = None
    temp_max_c: float | None = None

    @model_validator(mode="after")
    def _range(self) -> "CategoryIn":
        _check_range(self.temp_min_c, self.temp_max_c)
        return self


class Category(CategoryIn):
    id: int


class PackUnit(_In):
    unit: str = Field(min_length=1, max_length=20)
    base_qty: int = Field(gt=0)


class ProductIn(_In):
    name: str = Field(min_length=1, max_length=120)
    category_id: int
    base_unit: str = Field(min_length=1, max_length=20)
    # Optional override of the category range. Leave both empty to inherit it.
    temp_min_c: float | None = None
    temp_max_c: float | None = None
    # Stock below this many base units is flagged low. 0 turns the flag off.
    min_stock: int = Field(default=0, ge=0)
    sop: str = Field(default="", max_length=4000)
    pack_units: list[PackUnit] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def _check(self) -> "ProductIn":
        _check_range(self.temp_min_c, self.temp_max_c)
        units = [self.base_unit.lower(), *(p.unit.lower() for p in self.pack_units)]
        if len(set(units)) != len(units):
            raise ValueError("pack units must be unique and different from the base unit")
        return self


class Product(BaseModel):
    id: int
    name: str
    category_id: int
    category: str
    base_unit: str
    temp_min_c: float | None
    temp_max_c: float | None
    # The range the rules use: the product override, else the category default, else none.
    effective_temp_min_c: float | None
    effective_temp_max_c: float | None
    min_stock: int
    stock: int
    sop: str
    pack_units: list[PackUnit]
    low_stock: bool


class ExtractedLine(BaseModel):
    """One line read from an order photo. Untrusted: the model produced it."""

    name: str = Field(min_length=1, max_length=120)
    quantity: int = Field(gt=0)
    unit: str = Field(min_length=1, max_length=20)


class ExtractedLineOut(ExtractedLine):
    product_id: int | None


class DeliveryLineIn(_In):
    # None means staff could not match the line to a catalogue product. It always needs a manager.
    product_id: int | None = None
    name: str = Field(min_length=1, max_length=120)  # as written on the order
    quantity: int = Field(gt=0)
    unit: str = Field(min_length=1, max_length=20)
    temp_c: float | None = Field(default=None, ge=-60, le=100)  # probe reading
    expected_base_qty: int | None = Field(default=None, gt=0)


class DeliveryIn(_In):
    supplier: str = Field(default="", max_length=120)
    received_by: str = Field(min_length=1, max_length=80)
    lines: list[DeliveryLineIn] = Field(min_length=1, max_length=100)


class LineCheck(BaseModel):
    passed: bool
    issues: list[str]
    received_base_qty: int | None = None


class DeliveryLine(BaseModel):
    id: int
    product_id: int | None
    name: str
    quantity: int
    unit: str
    temp_c: float | None
    expected_base_qty: int | None
    received_base_qty: int | None
    passed: bool
    issues: list[str]


class Delivery(BaseModel):
    id: int
    supplier: str
    received_by: str
    status: DeliveryStatus
    created_at: str
    decided_by: str | None
    decided_at: str | None
    decision_reason: str | None
    lines: list[DeliveryLine]


class DecisionIn(_In):
    decision: Literal["accept", "reject", "return"]
    decided_by: str = Field(min_length=1, max_length=80)
    reason: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def _reason_needed(self) -> "DecisionIn":
        if self.decision != "accept" and not self.reason:
            raise ValueError("a reason is required to reject or return a delivery")
        return self


class AuditEntry(BaseModel):
    id: int
    at: str
    actor: str
    action: str
    delivery_id: int | None
    detail: str
