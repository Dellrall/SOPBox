import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
    archived: bool = False


class ArchiveIn(_In):
    archived: bool


class ExtractedLine(BaseModel):
    """One line read from an order photo. Untrusted: the model produced it.

    A quantity or unit the model could not read is None, so staff see the line and fill it in,
    rather than the line being dropped or a number guessed."""

    name: str = Field(min_length=1, max_length=120)
    quantity: int | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, min_length=1, max_length=20)
    warning: str | None = Field(default=None, max_length=200)

    @field_validator("unit", "warning", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value


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


# ---- accounts ---------------------------------------------------------------------------------

Role = Literal["owner", "manager", "staff"]
_USERNAME = re.compile(r"^[a-z0-9._-]{3,32}$")
_CHAT_ID = re.compile(r"^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})?$")


# A practical check, not RFC 5322: one @, no spaces, a dot in the domain. Nothing is sent to it yet.
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _email(value: str | None) -> str | None:
    """Lower-case and check an email. Empty means none."""
    if value is None:
        return None
    value = value.strip().lower()
    if not value:
        return None
    if len(value) > 254 or not _EMAIL.match(value):
        raise ValueError("enter a valid email address, like name@example.com")
    return value


def _username(value: str) -> str:
    value = value.strip().lower()
    if not _USERNAME.match(value):
        raise ValueError("username must be 3 to 32 characters: letters, digits, dot, dash, underscore")
    return value


Username = Annotated[str, Field(min_length=3, max_length=32)]
Password = Annotated[str, Field(min_length=8, max_length=128)]


class RegisterIn(_In):
    """Creates a workspace. Whoever registers it becomes its owner."""

    workspace_name: str = Field(min_length=1, max_length=80)
    display_name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    username: Username
    password: Password

    @model_validator(mode="after")
    def _clean(self) -> "RegisterIn":
        self.username = _username(self.username)
        self.email = _email(self.email) or ""
        if not self.email:
            raise ValueError("enter your email address")
        return self


class LoginIn(_In):
    # A username or an email address.
    username: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class WorkspaceRef(BaseModel):
    id: int
    name: str


class Me(BaseModel):
    id: int
    username: str
    email: str | None
    display_name: str
    role: Role
    workspace: WorkspaceRef


class ProfileUpdateIn(_In):
    """A person's own name and email. Only the fields that are sent change; an empty email removes it."""

    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    email: str | None = Field(default=None, max_length=254)

    @model_validator(mode="after")
    def _clean(self) -> "ProfileUpdateIn":
        if self.email is not None:
            self.email = _email(self.email) or ""
        return self


class PasswordChangeIn(_In):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: Password


class UserCreateIn(_In):
    username: Username
    display_name: str = Field(min_length=1, max_length=80)
    email: str | None = Field(default=None, max_length=254)
    role: Literal["manager", "staff"]
    password: Password

    @model_validator(mode="after")
    def _clean(self) -> "UserCreateIn":
        self.username = _username(self.username)
        self.email = _email(self.email)
        return self


class UserUpdateIn(_In):
    """Only the fields that are sent change. A new password signs the person out everywhere."""

    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    email: str | None = Field(default=None, max_length=254)
    role: Literal["manager", "staff"] | None = None
    active: bool | None = None
    password: Password | None = None

    @model_validator(mode="after")
    def _clean(self) -> "UserUpdateIn":
        # An empty email is kept as "" so it reaches the update and clears the address.
        if self.email is not None:
            self.email = _email(self.email) or ""
        return self


class UserOut(BaseModel):
    id: int
    username: str
    email: str | None
    display_name: str
    role: Role
    active: bool
    created_at: str


class WorkspaceSettings(BaseModel):
    id: int
    name: str
    telegram_manager_chat_id: str
    telegram_staff_chat_id: str


class WorkspaceUpdateIn(_In):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    telegram_manager_chat_id: str | None = Field(default=None, max_length=40)
    telegram_staff_chat_id: str | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def _chat_ids(self) -> "WorkspaceUpdateIn":
        for value in (self.telegram_manager_chat_id, self.telegram_staff_chat_id):
            if value is not None and not _CHAT_ID.match(value):
                raise ValueError("a Telegram chat id is a number (or @channelname), or empty")
        return self
