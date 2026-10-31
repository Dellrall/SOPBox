import base64
import re
import unicodedata
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

DeliveryStatus = Literal["accepted", "pending_approval", "rejected", "returned"]


def _check_range(low: float | None, high: float | None) -> None:
    if (low is None) != (high is None):
        raise ValueError("give both the lowest and the highest temperature, or leave both empty")
    if low is not None and high is not None and low > high:
        raise ValueError("the lowest temperature must not be above the highest")


# Characters that are never wanted in stored text: control characters (a NUL byte would make the
# database refuse the row), zero-width characters, and the bidi overrides that can make a name
# display differently from what it is ("Trojan Source").
_INVISIBLE = re.compile(
    "[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]"
)


def clean_text(value: str) -> str:
    """NFC-normalise and drop invisible characters. Newlines and tabs are kept (SOP text)."""
    return _INVISIBLE.sub("", unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n")))


def _clean_all(value: object) -> object:
    if isinstance(value, str):
        return clean_text(value)
    if isinstance(value, list):
        return [_clean_all(v) for v in value]
    if isinstance(value, dict):
        return {k: _clean_all(v) for k, v in value.items()}
    return value


class _Clean(BaseModel):
    """Cleans every string it receives, including text a model produced from a photo."""

    @model_validator(mode="before")
    @classmethod
    def _clean_strings(cls, data: object) -> object:
        return _clean_all(data)


class _In(_Clean):
    """Base for request bodies: clean text, then strip whitespace before length checks."""

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
    # The product's code on the POS or sales sheet (SKU). Empty: none.
    code: str | None = Field(default=None, max_length=40)
    # The barcode printed on the pack, as a scanner reads it. Empty: none.
    barcode: str | None = Field(default=None, max_length=40, pattern=r"^[0-9A-Za-z\-.]*$")
    # Expiry: each delivery needs a date; refuse less than `min_days_left` days; warn `warn_days` before.
    track_expiry: bool = False
    min_days_left: int | None = Field(default=None, ge=0, le=3650)
    warn_days: int = Field(default=3, ge=0, le=365)

    @model_validator(mode="after")
    def _check(self) -> "ProductIn":
        _check_range(self.temp_min_c, self.temp_max_c)
        self.code = self.code or None
        self.barcode = self.barcode or None
        units = [self.base_unit.lower(), *(p.unit.lower() for p in self.pack_units)]
        if len(set(units)) != len(units):
            raise ValueError("pack units must be unique and different from the base unit")
        return self


class SopDraftIn(_In):
    """A product as the form holds it (it may not be saved yet) and the manager's rough SOP notes."""

    name: str = Field(min_length=1, max_length=120)
    category_id: int
    base_unit: str = Field(min_length=1, max_length=20)
    temp_min_c: float | None = None
    temp_max_c: float | None = None
    pack_units: list[PackUnit] = Field(default_factory=list, max_length=10)
    notes: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def _check(self) -> "SopDraftIn":
        _check_range(self.temp_min_c, self.temp_max_c)
        return self


class SopIssue(_Clean):
    """Something the checking pass found in a drafted SOP. Untrusted: the model produced it."""

    step: int | None = Field(default=None, ge=1)
    problem: str = Field(min_length=1, max_length=300)


class SopDraft(BaseModel):
    sop: str
    issues: list[SopIssue]
    checked: bool  # False when the checking pass could not run: review every step yourself


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
    code: str | None = None
    barcode: str | None = None
    track_expiry: bool = False
    min_days_left: int | None = None
    warn_days: int = 3


class ArchiveIn(_In):
    archived: bool


class ExtractedLine(_Clean):
    """One line read from an order photo. Untrusted: the model produced it.

    A quantity or unit the model could not read is None, so staff see the line and fill it in,
    rather than the line being dropped or a number guessed."""

    name: str = Field(min_length=1, max_length=120)
    quantity: int | None = Field(default=None, gt=0)
    unit: str | None = Field(default=None, min_length=1, max_length=20)
    unit_price: float | None = Field(default=None, ge=0, le=1_000_000)  # RM per unit, as printed
    warning: str | None = Field(default=None, max_length=200)

    @field_validator("unit", "warning", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("unit_price", mode="before")
    @classmethod
    def _price(cls, value: object) -> object:
        """A printed "RM 1,250.50" reads as 1250.5. A price that cannot be read is dropped, not the line."""
        if isinstance(value, str):
            found = re.search(r"\d[\d,]*(?:\.\d+)?", value)
            value = float(found.group().replace(",", "")) if found else None
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1_000_000:
            return None
        return value


_PACK_SIZE = re.compile(
    r"^\s*(?P<qty>\d+)\s*(?P<base>[A-Za-z]+)\.?\s*(?:/|per)\s*(?P<pack>[A-Za-z]+)\.?\s*$", re.IGNORECASE
)


class ProductSuggestion(_Clean):
    """A product read from a supplier sheet. Untrusted: a manager reviews it before it is saved."""

    name: str = Field(min_length=1, max_length=120)
    category: str | None = Field(default=None, max_length=80)
    pack_size: str | None = Field(default=None, max_length=60)  # as printed, e.g. "10 pcs/ctn"
    base_unit: str | None = Field(default=None, max_length=20)
    pack_unit: str | None = Field(default=None, max_length=20)
    units_per_pack: int | None = Field(default=None, gt=0, le=100_000)
    temp_min_c: float | None = Field(default=None, ge=-60, le=100)
    temp_max_c: float | None = Field(default=None, ge=-60, le=100)
    sop: str | None = Field(default=None, max_length=4000)  # receiving or handling steps as printed
    warning: str | None = Field(default=None, max_length=200)

    @field_validator("category", "pack_size", "base_unit", "pack_unit", "sop", "warning", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="after")
    def _units_from_pack_size(self) -> "ProductSuggestion":
        # "10 pcs/ctn", "500 pcs per bdl": the printed pack size decides the units, not the
        # model's own fields, which it fills from the product name ("kg" from "Nuggets 1kg").
        if self.pack_size:
            found = _PACK_SIZE.match(self.pack_size)
            if found and 0 < int(found["qty"]) <= 100_000:
                self.units_per_pack = int(found["qty"])
                self.base_unit = found["base"]
                self.pack_unit = found["pack"]
            else:
                note = f"check the pack size: {self.pack_size}"
                self.warning = f"{self.warning}; {note}" if self.warning else note
        return self

    @model_validator(mode="after")
    def _one_sided_range_is_dropped(self) -> "ProductSuggestion":
        # Half a range cannot be saved; keep the reading as a note for the manager instead.
        if (self.temp_min_c is None) != (self.temp_max_c is None):
            known = self.temp_min_c if self.temp_min_c is not None else self.temp_max_c
            note = f"only one temperature was printed ({known} C)"
            self.warning = f"{self.warning}; {note}" if self.warning else note
            self.temp_min_c = self.temp_max_c = None
        return self


class ProductSuggestionOut(ProductSuggestion):
    category_id: int | None  # an existing category with that name, if any
    exists: bool  # a product with this name is already in the catalogue


class ProductsBulkIn(_In):
    products: list[ProductIn] = Field(min_length=1, max_length=200)



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
    unit_price_sen: int | None = Field(default=None, ge=0, le=100_000_000)  # one delivered unit, in sen
    expiry_on: date | None = None  # as printed on the pack
    expiry_later: bool = False  # the date cannot be seen yet: someone fills it in on the lot later


class DeliveryIn(_In):
    supplier: str = Field(default="", max_length=120)
    # Receiving against an issued purchase order: each line is checked against what is still
    # outstanding on it, and a product that is not on the order fails.
    purchase_order_id: int | None = None
    lines: list[DeliveryLineIn] = Field(min_length=1, max_length=100)
    photos: list["PhotoIn"] = Field(default_factory=list, max_length=4)
    # Teammates to tag on the delivery; each gets an inbox notification.
    tagged_user_ids: list[int] = Field(default_factory=list, max_length=20)
    # The storage area the stock is put away in. None: the workspace's first one.
    storage_id: int | None = None


class PhotoIn(_In):
    """A JPEG of the stock as it arrived, base64. About 2 MB at most; phones send far less."""

    data: str = Field(min_length=1, max_length=2_800_000)
    caption: str = Field(default="", max_length=300)

    @field_validator("data")
    @classmethod
    def _jpeg(cls, photo: str) -> str:
        try:
            data = base64.b64decode(photo, validate=True)
        except ValueError:
            raise ValueError("a photo is not valid base64") from None
        if not data.startswith(b"\xff\xd8\xff"):
            raise ValueError("photos must be JPEG images")
        return photo


class PhotoCommentIn(_In):
    # "@username" in the body tags that teammate on the delivery.
    body: str = Field(min_length=1, max_length=1000)


class TagsIn(_In):
    user_ids: list[int] = Field(min_length=1, max_length=20)


class DeliveryTag(BaseModel):
    user_id: int
    username: str
    display_name: str
    tagged_by: str
    created_at: str


class PhotoComment(BaseModel):
    id: int
    author: str
    body: str
    created_at: str


class DeliveryPhoto(BaseModel):
    id: int  # the image is at /api/deliveries/{delivery_id}/photos/{id}
    caption: str
    comments: list[PhotoComment]


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
    returned: bool = False  # sent back while the rest of the delivery was accepted
    unit_price_sen: int | None = None
    expiry_on: date | None = None
    expiry_later: bool = False


class Delivery(BaseModel):
    id: int
    supplier: str
    received_by: str
    status: DeliveryStatus
    created_at: str
    decided_by: str | None
    decided_at: str | None
    decision_reason: str | None
    purchase_order_id: int | None = None
    purchase_order: str | None = None  # its reference, e.g. PO-0007
    lines: list[DeliveryLine]
    photos: list[DeliveryPhoto] = []
    tags: list[DeliveryTag] = []
    storage: str | None = None  # "Outlet / Store"


class DecisionIn(_In):
    # accept_passed: stock the lines that passed, send the failed ones back to the supplier.
    decision: Literal["accept", "accept_passed", "reject", "return"]
    reason: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def _reason_needed(self) -> "DecisionIn":
        if self.decision != "accept" and not self.reason:
            raise ValueError("a reason is required to reject or return a delivery, or part of one")
        return self


class AuditEntry(BaseModel):
    id: int
    at: str
    actor: str
    action: str
    delivery_id: int | None
    detail: str
    actor_id: int | None = None  # the account; None for "system" and older entries


# ---- accounts ---------------------------------------------------------------------------------

Role = Literal["owner", "manager", "staff"]
AccessLevel = Literal["none", "view", "edit"]


class SectionAccess(_In):
    """Per-section access for staff; owner and manager roles retain their existing full access."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    dashboard: AccessLevel = "view"
    receive: AccessLevel = "edit"
    records: AccessLevel = "view"
    products: AccessLevel = "view"
    purchasing: AccessLevel = "none"
    approvals: AccessLevel = "none"
    activity: AccessLevel = "none"
    stocktake: AccessLevel = "view"


MAX_SAFE_COUNT = 9_007_199_254_740_991


class StocktakeLineIn(_In):
    product_id: int = Field(gt=0)
    expected_stock: int = Field(ge=0, le=MAX_SAFE_COUNT)
    counted_stock: int = Field(ge=0, le=MAX_SAFE_COUNT)


class StocktakeCreateIn(_In):
    count_date: date
    # The storage area counted. None: the workspace's first one.
    storage_id: int | None = None
    notes: str = Field(default="", max_length=1000)
    lines: list[StocktakeLineIn] = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def _unique_products(self) -> "StocktakeCreateIn":
        ids = [line.product_id for line in self.lines]
        if len(ids) != len(set(ids)):
            raise ValueError("a product can only be counted once in a stocktake")
        return self


class StocktakeLineOut(BaseModel):
    id: int
    product_id: int | None
    product_name: str
    base_unit: str
    expected_stock: int
    counted_stock: int
    difference: int


class StocktakeOut(BaseModel):
    id: int
    reference: str
    count_date: date
    counted_by: str
    created_at: str
    notes: str
    line_count: int
    changed_count: int
    storage: str | None = None  # "Outlet / Store"; None for counts made before storage areas


class StocktakeDetail(StocktakeOut):
    lines: list[StocktakeLineOut]


class CountGap(BaseModel):
    """One product a count did not match, with how the same product counted before."""

    product_id: int | None
    product_name: str
    base_unit: str
    expected_stock: int
    counted_stock: int
    difference: int
    share: float | None  # difference as a share of what was expected; None when 0 was expected
    earlier: list[int]  # differences at the earlier counts of this storage area, newest first
    pattern: Literal["repeat", "one_off", "over"]
    hint: str
    value_sen: int | None = None  # the difference at the latest delivered price; None with no price


class PriceChange(BaseModel):
    """A product's latest delivered price against the delivery before it, per base unit."""

    product_id: int
    product_name: str
    base_unit: str
    supplier: str
    before_sen: float  # per base unit
    now_sen: float
    change: float  # now / before - 1
    delivery_id: int
    received_at: str
    previous_at: str


class AskIn(_In):
    question: str = Field(min_length=1, max_length=300)


class AskAnswer(BaseModel):
    """An answer worked out from the records. `to` is the page with the details."""

    topic: Literal["waste", "reorder", "prices", "approvals", "use", "help"]
    text: str
    items: list[str] = []
    to: str | None = None


class CountInsights(BaseModel):
    stocktake_id: int
    reference: str
    sales_recorded: bool  # sales were taken off this storage area in the weeks before the count
    gaps: list[CountGap]


class GapExplanation(BaseModel):
    """The model's reading of a count's gaps. A suggestion only: the manager decides."""

    summary: str
    actions: list[str]


class StocktakePreviewLine(BaseModel):
    product_id: int
    product_name: str
    base_unit: str
    expected_stock: int
    counted_stock: int
    difference: int


class StocktakePreview(BaseModel):
    lines: list[StocktakePreviewLine]


class StocktakeProductOut(BaseModel):
    id: int
    name: str
    category: str
    base_unit: str
    stock: int
    bundle_unit: str | None  # the largest pack size, counted as whole bundles
    bundle_qty: int | None


class DashboardDeliveryOut(BaseModel):
    id: int
    supplier: str
    status: DeliveryStatus
    created_at: str
    purchase_order: str | None


class DashboardLowStockOut(BaseModel):
    id: int
    name: str
    stock: int
    min_stock: int
    base_unit: str


class DashboardDayOut(BaseModel):
    """One delivery in the chart window; the browser groups them by its own calendar day."""

    created_at: str
    status: DeliveryStatus


class DashboardSummary(BaseModel):
    product_count: int
    delivery_count: int
    pending_count: int
    accepted_count: int
    rejected_count: int
    returned_count: int
    recent_deliveries: list[DashboardDeliveryOut]
    low_stock_products: list[DashboardLowStockOut]
    # Deliveries from the last 15 days (one spare day covers any time zone), oldest first.
    recent_activity: list[DashboardDayOut]


# 3 to 32 of a-z, 0-9 and . _ -, starting and ending with a letter or number. No spaces or other
# symbols, so a username can always be typed again exactly, on any keyboard.
_USERNAME = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$")
USERNAME_RULE = (
    "a username is 3 to 32 characters: letters a-z, numbers, and . _ - only (no spaces or other "
    "symbols), starting and ending with a letter or number"
)
_CHAT_ID = re.compile(r"^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})?$")


# A practical check, not RFC 5322: one @, no spaces, a dot in the domain. Nothing is sent to it yet.
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _email(value: str | None) -> str | None:
    """Lower-case and check an email. Empty means none."""
    if value is None:
        return None
    value = normalise_login(value)
    if not value:
        return None
    if len(value) > 254 or not _EMAIL.match(value):
        raise ValueError("enter a valid email address, like name@example.com")
    return value


def normalise_login(value: str) -> str:
    """How a username or email is compared: NFKC turns full-width letters from phone keyboards
    into plain ones, then lower case. Used for storing and for signing in, so the two agree."""
    return unicodedata.normalize("NFKC", value).strip().lower()


def _username(value: str) -> str:
    value = normalise_login(value)
    if "@" in value:
        raise ValueError("a username cannot contain @ (your email goes in the Email field)")
    if not _USERNAME.match(value):
        raise ValueError(USERNAME_RULE)
    return value


def _phone(value: str) -> str:
    """Empty, or a phone number: 7 to 15 digits, with only +, spaces, dashes and brackets between."""
    value = value.strip()
    if value and (not re.fullmatch(r"\+?[\d\s()-]+", value) or not 7 <= sum(c.isdigit() for c in value) <= 15):
        raise ValueError("enter a phone number with 7 to 15 digits, for example +60 12-345 6789")
    return value


Phone = Annotated[str, Field(max_length=40), AfterValidator(_phone)]
Username = Annotated[str, Field(min_length=3, max_length=32)]
# Matched by the strength bar in AuthPage.tsx (easyPassword).
_COMMON_PASSWORDS = {"password", "password1", "password123", "passw0rd", "iloveyou", "sopbox123", "welcome1", "abcd1234", "qwerty123"}
_RUNS = ("01234567890", "09876543210", "abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm")


def _password(value: str) -> str:
    """Refuse a new password anyone could guess: one or a few repeated characters, a run, or a common one."""
    low = value.lower()
    if len(set(low)) < 4 or low in _COMMON_PASSWORDS or any(low in run for run in _RUNS):
        raise ValueError("this password is too easy to guess; use a few words, or mix letters and numbers")
    return value


Password = Annotated[str, Field(min_length=8, max_length=128), AfterValidator(_password)]


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


class UsernameCheck(BaseModel):
    username: str  # as it would be saved
    available: bool
    problem: str  # why not, or ""


class LoginIn(_In):
    # A username or an email address.
    username: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class WorkspaceRef(BaseModel):
    id: int
    public_id: str  # the random id in addresses and Settings; id stays internal
    name: str


class ClosingOut(BaseModel):
    """Set while the business is closed (closing.py): read-only, and deleted for good on delete_on."""

    closed_at: str | None = None
    delete_on: str | None = None  # YYYY-MM-DD


class CloseIn(_In):
    workspace_name: str = Field(min_length=1, max_length=200)  # typed again, so it is not closed by a slip


class OpsMember(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None
    role: Role
    active: bool


class OpsWorkspaceOut(BaseModel):
    id: int
    public_id: str
    name: str
    closed_on: str | None
    members: list[OpsMember]


class OwnerTransferIn(_In):
    username: str = Field(min_length=1, max_length=40)  # the new owner, already an active member
    reason: str = Field(min_length=3, max_length=300)  # kept in the activity log and told to the team
    old_owner: Literal["manager", "remove"] = "manager"


class SignIn(BaseModel):
    id: int
    at: str
    method: str  # password, register, passkey, google, telegram or kitchen_pin
    device: str  # e.g. "Chrome on Android"


class WorkspaceChoice(BaseModel):
    """A workspace this person can work in: their own, or a branch linked to their HQ."""

    id: int
    public_id: str
    name: str
    role: Role  # their role while working there


class Me(BaseModel):
    id: int
    username: str
    email: str | None
    display_name: str
    role: Role
    section_access: SectionAccess
    workspace: WorkspaceRef
    # The sign-in before this session's, so a person notices one they did not make.
    previous_sign_in: SignIn | None = None
    # How this session was started, so the sign-in page can mark it "Last used" next time.
    sign_in_method: str | None = None
    mfa_enabled: bool = False  # two-step sign-in is on
    mfa_pending: bool = False  # signed in, but the authenticator code is still to be entered
    mfa_setup_needed: bool = False  # the workspace requires two-step sign-in and it is not on yet
    can_export: bool = False  # may download data: the owner, and whoever the owner allows
    outlet_id: int | None = None  # the outlet they work at; the app starts them there
    assistant: bool = False  # an assistant manager
    closing: ClosingOut = ClosingOut()  # their own workspace's
    # Their own workspace first, then the branches linked to it when it is an HQ.
    workspaces: list[WorkspaceChoice] = []


class ProfileUpdateIn(_In):
    """A person's own username, name and email. Only the fields that are sent change; an empty email
    removes it. The account's id never changes, so records stay theirs after a rename."""

    username: Username | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    email: str | None = Field(default=None, max_length=254)

    @model_validator(mode="after")
    def _clean(self) -> "ProfileUpdateIn":
        if self.username is not None:
            self.username = _username(self.username)
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
    section_access: SectionAccess = Field(default_factory=SectionAccess)
    outlet_id: int | None = None  # a manager's new staff always go to the manager's outlet
    assistant: bool = False  # with role manager: an assistant manager

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
    section_access: SectionAccess | None = None
    security_alerts: bool | None = None  # hears about dangerous actions, as the owner does
    mfa_reset: bool | None = None  # true: turn their two-step sign-in off (they lost their phone)
    can_export: bool | None = None  # may download the workspace's data (Settings)
    outlet_id: int | None = None  # sent as null: not tied to an outlet
    assistant: bool | None = None  # with role manager: an assistant manager

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
    section_access: SectionAccess
    active: bool
    created_at: str
    telegram_linked: bool = False
    # Kept out of the Telegram team group until then (team_group.FOREVER: until let back in).
    team_group_removed_until: str | None = None
    security_alerts: bool = False
    mfa_enabled: bool = False
    can_export: bool = False
    outlet_id: int | None = None
    assistant: bool = False


class TeamGroupIn(_In):
    chat_id: str = Field(pattern=r"^-?\d{1,20}$", description="The group's chat id, e.g. -1001234567890")


class TeamGroupRemoveIn(_In):
    """How long to keep the person out of the team group; None: until the owner lets them back in."""

    hours: Literal[1, 24, 168] | None = None


# Who must use two-step sign-in (mfa.py).
MfaPolicy = Literal["off", "managers", "everyone"]


class WorkspaceSettings(BaseModel):
    id: int
    public_id: str
    name: str
    telegram_manager_chat_id: str
    telegram_staff_chat_id: str
    # The team group people join (team_group.py); empty when none is connected.
    telegram_team_chat_id: str = ""
    telegram_team_title: str = ""
    telegram_team_invite_link: str = ""
    mfa_policy: MfaPolicy = "off"
    big_order_sen: int = 100000  # an order worth this much, or with big_order_lines lines, is big
    big_order_lines: int = 10


class WorkspaceUpdateIn(_In):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    telegram_manager_chat_id: str | None = Field(default=None, max_length=40)
    telegram_staff_chat_id: str | None = Field(default=None, max_length=40)
    mfa_policy: MfaPolicy | None = None
    big_order_sen: int | None = Field(default=None, ge=0, le=MAX_SAFE_COUNT)
    big_order_lines: int | None = Field(default=None, ge=1, le=1000)

    @model_validator(mode="after")
    def _chat_ids(self) -> "WorkspaceUpdateIn":
        for value in (self.telegram_manager_chat_id, self.telegram_staff_chat_id):
            if value is not None and not _CHAT_ID.match(value):
                raise ValueError("a Telegram chat id is a number (or @channelname), or empty")
        return self


# ---- purchasing ---------------------------------------------------------------------------------


class SupplierIn(_In):
    name: str = Field(min_length=1, max_length=120)
    contact: str = Field(default="", max_length=120)
    phone: Phone = ""
    email: str = Field(default="", max_length=254)
    # The products this supplier sells. Left out on an update, the current list is kept.
    product_ids: list[int] | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _clean(self) -> "SupplierIn":
        self.email = _email(self.email) or ""
        if self.product_ids is not None:
            self.product_ids = list(dict.fromkeys(self.product_ids))
        return self


class Supplier(BaseModel):
    id: int
    name: str
    contact: str
    phone: str
    email: str
    archived: bool
    product_ids: list[int]


class PurchaseOrderLineIn(_In):
    product_id: int
    quantity: int = Field(gt=0, le=1_000_000)
    unit: str = Field(min_length=1, max_length=20)


class PurchaseOrderIn(_In):
    supplier_id: int
    order_date: date
    expected_date: date | None = None
    notes: str = Field(default="", max_length=1000)
    lines: list[PurchaseOrderLineIn] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def _check(self) -> "PurchaseOrderIn":
        if self.expected_date and self.expected_date < self.order_date:
            raise ValueError("the expected delivery date cannot be before the order date")
        ids = [line.product_id for line in self.lines]
        if len(ids) != len(set(ids)):
            raise ValueError("each product can appear once: combine its quantity on one line")
        return self


class CancelIn(_In):
    reason: str = Field(default="", max_length=500)


class LowStockSupplier(BaseModel):
    """A supplier that Draft from low stock would order something from, and what."""

    supplier_id: int
    name: str
    products: list[str]  # the low-stock products it would order
    has_product_list: bool  # False: no list set, so it is offered everything that is low


class ReorderSuggestion(BaseModel):
    """What to order of one product: enough for COVER_DAYS of recent use plus its minimum."""

    product_id: int
    product_name: str
    base_unit: str
    stock: int
    min_stock: int
    daily_use: float  # base units a day over the recent window; 0 when no use is recorded
    days_left: float | None  # how long the stock lasts at that rate; None with no recorded use
    on_order: int
    quantity: int  # still to order, after what is on open orders
    reason: str


class LowStockDraftIn(_In):
    supplier_id: int
    # The person's local date. The server may run in UTC, a day behind Malaysia before 08:00.
    order_date: date | None = None


class PurchaseOrderLine(BaseModel):
    id: int
    product_id: int
    product_name: str
    quantity: int
    unit: str
    base_unit: str
    ordered_base_qty: int
    received_base_qty: int  # on accepted deliveries
    pending_base_qty: int  # on deliveries still waiting for a manager
    outstanding_base_qty: int


PurchaseOrderStatus = Literal["draft", "issued", "cancelled"]
ReceivingStatus = Literal["not_received", "partially_received", "fully_received"]


class PurchaseOrder(BaseModel):
    id: int
    reference: str
    supplier_id: int
    supplier: str
    status: PurchaseOrderStatus
    receiving_status: ReceivingStatus
    order_date: str
    expected_date: str | None
    notes: str
    created_by: str
    created_at: str
    issued_by: str | None
    issued_at: str | None
    cancelled_by: str | None
    cancelled_at: str | None
    lines: list[PurchaseOrderLine]
    delivery_ids: list[int]


# ---- teammates, tags and the inbox --------------------------------------------------------------


class TeamMember(BaseModel):
    """An active teammate, for tagging and for filtering the activity log. Any signed-in user may see these."""

    id: int
    username: str
    display_name: str
    role: Role


NotificationKind = Literal["tagged", "approval_needed", "decided", "comment", "sign_in", "security", "expiry"]


class Notification(BaseModel):
    id: int
    kind: NotificationKind
    delivery_id: int | None
    actor: str
    body: str
    created_at: str
    read: bool


class Inbox(BaseModel):
    unread: int
    items: list[Notification]


class NotificationsReadIn(_In):
    ids: list[int] | None = Field(default=None, max_length=200)  # None marks everything read


class Accountability(BaseModel):
    """What one person has done, counted from the audit log by account."""

    user_id: int
    username: str
    display_name: str
    role: Role
    active: bool
    received: int
    decided: int
    stock_counts: int
    purchase_orders: int
    comments: int
    tagged: int  # deliveries they are tagged on
    last_active: str | None
    last_sign_in: str | None = None


# ---- other ways to sign in --------------------------------------------------------------------


class SignInMethods(BaseModel):
    """Which buttons the sign-in page shows. Passkeys always work; the others need setting up."""

    google: bool
    telegram_bot_id: str | None  # the public part of the bot token, for Telegram's login page


class PasskeyOut(BaseModel):
    id: int
    name: str
    created_at: str
    last_used_at: str | None


class PasskeyRegisterIn(_In):
    credential: dict[str, Any]  # the browser's answer, passed through to the WebAuthn check
    name: str = Field(default="Passkey", min_length=1, max_length=60)


class PasskeyLoginIn(BaseModel):
    credential: dict[str, Any]


class TelegramAuthIn(BaseModel):
    """What Telegram's login page returns: the person's id, profile and a hash over all of it."""

    model_config = ConfigDict(extra="allow")
    id: int
    auth_date: int
    hash: str = Field(max_length=128)


class PinIn(_In):
    pin: str | None = Field(default=None, pattern=r"^\d{4,8}$")  # None removes it


class KitchenDeviceIn(_In):
    name: str = Field(default="Kitchen tablet", min_length=1, max_length=60)


class KitchenDeviceOut(BaseModel):
    id: int
    name: str
    created_by: str
    created_at: str
    last_used_at: str | None
    this_device: bool = False


class KitchenPerson(BaseModel):
    id: int
    display_name: str


class KitchenScreen(BaseModel):
    device_name: str
    workspace_name: str
    people: list[KitchenPerson]


class KitchenLoginIn(_In):
    user_id: int
    pin: str = Field(min_length=4, max_length=8)


class SecurityOut(BaseModel):
    """A person's own sign-in methods and recent sign-ins, for Settings."""

    google_linked: bool
    telegram_linked: bool
    pin_set: bool
    passkeys: list[PasskeyOut]
    recent_sign_ins: list[SignIn]
    # The workspace's Telegram team group, when this person may join it.
    team_group_title: str | None = None
    team_group_link: str | None = None


# ---- outlets, storage areas, transfers and sales -------------------------------------------------


class NameIn(_In):
    name: str = Field(min_length=1, max_length=80)


class StorageIn(NameIn):
    outlet_id: int


class StorageOut(BaseModel):
    id: int
    name: str
    outlet_id: int
    outlet: str
    label: str  # "Outlet / Store"


class OutletOut(BaseModel):
    id: int
    name: str
    storages: list[StorageOut]


class StockLevelOut(BaseModel):
    product_id: int
    name: str
    code: str | None
    barcode: str | None = None
    category: str
    base_unit: str
    quantity: int  # in this storage area
    total: int  # over every storage area of the same outlet


class _ProductQuantity(_In):
    product_id: int = Field(gt=0)
    quantity: int = Field(gt=0, le=MAX_SAFE_COUNT)


def _unique_products(lines: list[_ProductQuantity]) -> None:
    ids = [line.product_id for line in lines]
    if len(ids) != len(set(ids)):
        raise ValueError("each product can only be listed once")


class TransferIn(_In):
    from_storage_id: int
    to_storage_id: int
    notes: str = Field(default="", max_length=500)
    lines: list[_ProductQuantity] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def _check(self) -> "TransferIn":
        if self.from_storage_id == self.to_storage_id:
            raise ValueError("pick two different storage areas")
        _unique_products(self.lines)
        return self


class TransferLineOut(BaseModel):
    product_id: int | None
    product_name: str
    base_unit: str
    quantity: int


class TransferOut(BaseModel):
    id: int
    reference: str
    from_storage: str
    to_storage: str
    moved_by: str
    created_at: str
    notes: str
    lines: list[TransferLineOut]


LotStatus = Literal["expired", "soon", "ok", "no_date"]
DisposalMethod = Literal["food_waste", "donated", "returned", "general_waste"]


class LotOut(BaseModel):
    """What is left of one received batch, where it is, and where it came from."""

    id: int
    code: str  # written on the box, e.g. L2610-0012
    product_id: int
    product: str
    base_unit: str
    storage_id: int
    location: str  # "Outlet: Storage area"
    expiry_on: date | None
    days_left: int | None
    status: LotStatus
    left: int  # base units still on the shelf, earliest expiry used first
    received: int
    supplier: str
    delivery_id: int | None
    purchase_order: str | None  # e.g. PO-000012
    received_at: str


class LotExpiryIn(_In):
    expiry_on: date


class DisposeIn(_In):
    quantity: int = Field(gt=0)
    method: DisposalMethod
    notes: str = Field(default="", max_length=300)


class DisposalOut(BaseModel):
    id: int
    lot_code: str | None
    product: str
    location: str
    quantity: int
    base_unit: str
    method: DisposalMethod
    value_sen: int | None
    notes: str
    disposed_by: str
    created_at: str


class SaleIn(_In):
    storage_id: int
    sale_date: date
    source: str = Field(default="", max_length=200)  # the uploaded file's name
    lines: list[_ProductQuantity] = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def _check(self) -> "SaleIn":
        _unique_products(self.lines)
        return self


class SalePreviewLine(BaseModel):
    product_id: int
    code: str
    product_name: str
    base_unit: str
    quantity: int
    in_stock: int  # in the chosen storage area


class SalePreview(BaseModel):
    lines: list[SalePreviewLine]
    unknown_codes: list[str]  # codes no active product has; left out


class SaleLineOut(BaseModel):
    product_id: int | None
    product_code: str
    product_name: str
    base_unit: str
    quantity: int
    deducted: int


class SaleOut(BaseModel):
    id: int
    reference: str
    storage: str
    sale_date: date
    source: str
    recorded_by: str
    created_at: str
    lines: list[SaleLineOut]


# ---- HQ and branches -----------------------------------------------------------------------------


class LinkCodeOut(BaseModel):
    code: str  # shown once; only its hash is kept
    expires_at: str


class LinkCodeIn(_In):
    code: str = Field(min_length=1, max_length=100)


class LinksOut(BaseModel):
    hq: WorkspaceRef | None  # the HQ this workspace is a branch of
    branches: list[WorkspaceRef]  # the branches linked to this workspace


# ---- API keys --------------------------------------------------------------------------------


class ApiKeyIn(_In):
    name: str = Field(min_length=1, max_length=60)  # e.g. "Till 1, KL"
    storage_id: int  # the one storage area the key's sales come off and its stock reads cover


class ApiKeyOut(BaseModel):
    id: int
    name: str
    hint: str  # the key's last four characters, to tell keys apart
    storage: str
    created_by: str
    created_at: str
    last_used_at: str | None


class ApiKeyCreated(ApiKeyOut):
    key: str  # shown once; only its hash is kept


class ApiSaleLineIn(_In):
    code: str = Field(min_length=1, max_length=100)  # the product code (SKU)
    quantity: int = Field(gt=0, le=MAX_SAFE_COUNT)


class ApiSaleIn(_In):
    sale_date: date
    # The till's receipt or batch number. Sending the same one again returns the first sale and
    # changes no stock, so a till can safely retry after a timeout.
    reference: str | None = Field(default=None, min_length=1, max_length=100)
    lines: list[ApiSaleLineIn] = Field(min_length=1, max_length=5000)


class ApiSaleOut(BaseModel):
    sale: SaleOut
    unknown_codes: list[str]  # codes no active product has; left out of the sale


# ---- two-step sign-in ------------------------------------------------------------------------


class MfaSetupOut(BaseModel):
    secret: str  # base32, for typing into an authenticator app
    uri: str  # otpauth:// link that opens the app on a phone


class MfaCodeIn(_In):
    code: str = Field(min_length=6, max_length=20)  # 6 digits, or a backup code


class MfaEnabledOut(BaseModel):
    backup_codes: list[str]  # shown once; each works once


# ---- plans, enquiries and support -------------------------------------------------------------


class SetupOut(BaseModel):
    """Which first steps of setting up a workspace are done."""

    outlet: bool  # an outlet has its own name
    storage: bool  # a storage area was added or renamed
    product: bool
    team: bool  # someone besides the owner
    delivery: bool


class PlanOut(BaseModel):
    plan: Literal["free", "pro", "enterprise"]
    label: str
    pre_alpha: bool  # here before plans: keeps what it set up then
    billing: Literal["annual", "lifetime"] | None
    until: date | None  # annual: paid up to and including
    lapsed: bool  # an annual plan ran out, so it counts as Free until renewed
    outlets_allowed: int | None  # None: no limit
    outlets_used: int
    api_access: bool
    hq_links: bool
    customization: bool
    priority_support: bool
    # Pay for what is used: outlets with work recorded this calendar month, and what Pro would bill for it.
    active_outlets: int = 0
    bill_sen: int | None = None  # None: not billed by use (Free, Enterprise, or no price set)


class PlanCodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)


class PricingOut(BaseModel):
    currency: str
    prices: dict[str, int | None]  # None: not decided yet ("TBC")
    kofi_url: str
    sales_email: str
    sales_phone: str


class SalesInquiryIn(_In):
    """From the public contact page: a question for the team, or a sales enquiry."""

    topic: Literal["sales", "question"] = "sales"
    name: str = Field(min_length=1, max_length=120)
    company: str = Field(default="", max_length=120)
    email: str = Field(min_length=3, max_length=254)
    phone: Phone = ""
    outlets: int | None = Field(default=None, ge=1, le=100_000)
    message: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def _clean(self) -> "SalesInquiryIn":
        self.email = _email(self.email) or ""
        if not self.email:
            raise ValueError("enter your email address")
        if self.topic == "question" and not self.message.strip():
            raise ValueError("write your question")
        return self


class UpgradeRequestIn(_In):
    billing: Literal["annual", "lifetime"]
    outlets: int = Field(ge=1, le=10_000)  # how many outlets in total
    customization: bool = False
    priority_support: bool = False
    phone: Phone = ""
    message: str = Field(default="", max_length=4000)


class SupportIn(_In):
    message: str = Field(min_length=1, max_length=4000)


class InquiryOut(BaseModel):
    id: int
    priority: bool


class TaskListIn(_In):
    name: str = Field(min_length=1, max_length=80)
    # daily: every day (opening, closing). event: when it happens (peak hour, a new starter).
    kind: Literal["daily", "event"]
    for_role: Literal["everyone", "staff", "manager"] = "everyone"
    steps: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]] = Field(
        min_length=1, max_length=40
    )


class TaskTick(BaseModel):
    step: int
    done_by: str
    done_at: str


class TaskList(BaseModel):
    id: int
    name: str
    kind: str
    for_role: str
    steps: list[str]
    ticks: list[TaskTick]  # the steps done on the day asked for


class TickIn(_In):
    day: date
    step: int = Field(ge=0)
    done: bool


JobKind = Literal["po", "delivery", "count"]


class Pic(BaseModel):
    user_id: int
    name: str


class Job(BaseModel):
    """Open work that needs a person in charge: an issued order still to arrive, a held delivery,
    or a planned stock count. Worked out from the records each time; nothing is stored but the PICs."""

    kind: JobKind
    ref_id: int
    title: str
    when: str  # what to do now, from the due date: "Due tomorrow: check it is on the way"
    due: str | None  # ISO date
    days_left: int | None  # negative when late
    big: bool
    pics: list[Pic]
    can_take: bool  # this person may add themselves without asking
    asked: bool  # this person has asked to take over and waits for a manager
    page: str  # where to do it
    steps: list[str]  # the SOP for this job, written by code from the order's products and rules
    ticks: list["JobTick"]


class AssignIn(_In):
    kind: JobKind
    ref_id: int = Field(gt=0)
    user_id: int | None = Field(default=None, gt=0)  # empty: yourself


class AssignOut(BaseModel):
    status: Literal["assigned", "already", "requested"]


class AssignmentRequest(BaseModel):
    id: int
    kind: JobKind
    ref_id: int
    title: str
    user_id: int
    name: str
    replaces: list[str]  # the current PICs, who the request would replace
    created_at: str


class RequestDecisionIn(_In):
    approve: bool


class CountPlanIn(_In):
    storage_id: int = Field(gt=0)
    due_date: date
    user_id: int | None = Field(default=None, gt=0)  # the PIC; empty: none yet


class Efficiency(BaseModel):
    """One person's record over the last `days`, all counted from saved records."""

    user_id: int
    name: str
    role: str
    jobs_due: int  # jobs they were PIC of that fell due (orders expected, counts planned)
    jobs_on_time: int  # of those, received or counted by the due date
    deliveries: int  # deliveries they checked
    avg_days_late: float | None  # against the order's expected date; negative is early
    lines_checked: int
    lines_failed: int  # lines that failed a rule: a training hint, not always their fault
    counts: int
    gap_sen_per_count: int | None  # the value of what their counts found missing or extra, per count


class JobTick(BaseModel):
    step: str
    done_by: str


class JobTickIn(_In):
    step: str = Field(min_length=1, max_length=300)
    done: bool


Job.model_rebuild()
