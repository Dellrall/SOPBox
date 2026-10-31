import asyncio
import hmac
from contextlib import contextmanager
from dataclasses import replace
import logging
from datetime import date, datetime, timedelta, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

import psycopg
from fastapi import BackgroundTasks, Depends, FastAPI, File, Query, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import accounts, auth, catalogue, deliveries, inbox, kitchen, passkeys, purchasing, sso, team_group
from app import apikeys, ask, assistant, reports, sales_ai, telegram_bot, closing, export, hq, inquiries, insights, locations, lots, mfa, notifications, ops, plans, sales, seo, stocktakes, tasks, assignments, efficiency
from app.auditlog import audit as audit_entry
from app.config import get_settings
from app.auth import CurrentUser, ManagerUp, OwnerOnly, User
from app.db import close_pool, get_db, init_db
from app.errors import (
    MfaRequiredError,
    AuthError,
    ConflictError,
    ExtractionError,
    ForbiddenError,
    InvalidRequestError,
    NotFoundError,
    RateLimitError,
)
from app.extraction import explain_gaps, extract_lines, extract_products, write_sop
from app.models import (
    ReportFilter,
    ReportKind,
    ReportOut,
    ApiSoldItemsIn,
    ApiSoldItemsOut,
    SaleDraftOut,
    SalesConfirmIn,
    SalesDraft,
    SalesReadIn,
    AssignIn,
    AssignmentRequest,
    AssignOut,
    CountPlanIn,
    Job,
    JobKind,
    JobTickIn,
    RequestDecisionIn,
    TaskList,
    TaskListIn,
    TickIn,
    AskAnswer,
    AssistantIn,
    AssistantOut,
    AskIn,
    PriceChange,
    CountInsights,
    GapExplanation,
    ReorderSuggestion,
    CloseIn,
    ClosingOut,
    OpsWorkspaceOut,
    OwnerTransferIn,
    InquiryOut,
    PlanCodeIn,
    PlanOut,
    PricingOut,
    SalesInquiryIn,
    SupportIn,
    UpgradeRequestIn,
    MfaCodeIn,
    MfaEnabledOut,
    MfaSetupOut,
    SetupOut,
    UsernameCheck,
    ApiKeyCreated,
    ApiKeyIn,
    ApiKeyOut,
    ApiSaleIn,
    ApiSaleOut,
    Accountability,
    Efficiency,
    KitchenDeviceIn,
    KitchenDeviceOut,
    KitchenLoginIn,
    KitchenScreen,
    PasskeyLoginIn,
    PasskeyOut,
    PasskeyRegisterIn,
    PinIn,
    SecurityOut,
    SignInMethods,
    TeamGroupIn,
    TeamGroupRemoveIn,
    TelegramAuthIn,
    ArchiveIn,
    Inbox,
    NotificationsReadIn,
    TagsIn,
    TeamMember,
    SopDraft,
    SopDraftIn,
    CancelIn,
    LowStockDraftIn,
    LowStockSupplier,
    PurchaseOrder,
    PurchaseOrderIn,
    Supplier,
    SupplierIn,
    AuditEntry,
    Category,
    CategoryIn,
    DashboardDeliveryOut,
    DashboardDayOut,
    DashboardLowStockOut,
    DashboardSummary,
    DecisionIn,
    PhotoCommentIn,
    Delivery,
    DeliveryIn,
    DeliveryStatus,
    ExtractedLineOut,
    LoginIn,
    Me,
    PasswordChangeIn,
    ProfileUpdateIn,
    Product,
    ProductIn,
    ProductsBulkIn,
    ProductSuggestionOut,
    RegisterIn,
    UserCreateIn,
    UserOut,
    UserUpdateIn,
    StocktakeCreateIn,
    StocktakeDetail,
    StocktakeOut,
    StocktakePreview,
    StocktakeProductOut,
    WorkspaceChoice,
    WorkspaceRef,
    WorkspaceSettings,
    WorkspaceUpdateIn,
    LinkCodeIn,
    LinkCodeOut,
    LinksOut,
    NameIn,
    OutletOut,
    SaleIn,
    SaleOut,
    SalePreview,
    StockLevelOut,
    StorageIn,
    TransferIn,
    TransferOut,
    LotOut,
    LotExpiryIn,
    DisposeIn,
    DisposalOut,
)
from app.notifications import approval_needed_message, decision_message, send_telegram
from app.security import SECURITY_HEADERS

logger = logging.getLogger("sopbox")

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

CatalogueReader = Annotated[
    CurrentUser,
    Depends(auth.require_any_section("receive", "products", "purchasing")),
]
ProductEditor = Annotated[CurrentUser, Depends(auth.require_any_section("products", edit=True))]
PurchasingReader = Annotated[
    CurrentUser,
    Depends(auth.require_any_section("purchasing", "receive")),
]
PurchasingEditor = Annotated[
    CurrentUser,
    Depends(auth.require_any_section("purchasing", edit=True)),
]
DeliveryReader = Annotated[
    CurrentUser,
    Depends(auth.require_any_section("records", "approvals")),
]
ReceivingEditor = Annotated[CurrentUser, Depends(auth.require_any_section("receive", edit=True))]
ApprovalsEditor = Annotated[CurrentUser, Depends(auth.require_any_section("approvals", edit=True))]
ActivityReader = Annotated[CurrentUser, Depends(auth.require_any_section("activity"))]
StocktakeReader = Annotated[CurrentUser, Depends(auth.require_any_section("stocktake"))]
StocktakeEditor = Annotated[
    CurrentUser, Depends(auth.require_any_section("stocktake", edit=True))
]
DashboardReader = Annotated[CurrentUser, Depends(auth.require_any_section("dashboard"))]


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    with contextmanager(get_db)() as conn:
        mfa.encrypt_stored(conn)  # secrets saved before encryption arrived
    deleter = asyncio.create_task(_delete_closed_workspaces())
    yield
    deleter.cancel()
    close_pool()


def _delete_due() -> None:
    with contextmanager(get_db)() as conn:
        if count := closing.delete_due(conn):
            logger.info("deleted %s closed workspace(s)", count)


async def _delete_closed_workspaces() -> None:
    """Hourly, and at each start (an app that sleeps when idle may miss some hours)."""
    while True:
        try:
            await asyncio.to_thread(_delete_due)
        except Exception:
            logger.exception("deleting closed workspaces failed; trying again in an hour")
        await asyncio.sleep(3600)


# Swagger UI loads its script from a CDN, which the strict CSP below would block.
app = FastAPI(title="SopBox API", lifespan=lifespan, docs_url=None, redoc_url=None)
# Compressed, the app's script is about a quarter of its size: much quicker on a phone's data.
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def add_response_headers(request: Request, call_next):
    """Security headers on everything; long caching only for files whose names never change."""
    response = await call_next(request)
    response.headers.update(SECURITY_HEADERS)
    path = request.url.path
    if path.startswith("/assets/"):
        # Vite fingerprints these names, so a file never changes once published.
        response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
    elif not path.startswith("/api/") and response.headers.get("content-type", "").startswith(("image/", "application/manifest")):
        response.headers.setdefault("Cache-Control", "public, max-age=86400")
    return response


Conn = Annotated[psycopg.Connection, Depends(get_db)]


def dangerous(action: str):
    """For actions that are hard to undo: needs a fresh authenticator code (mfa.require_fresh), and
    once the action succeeded tells the owner and the people picked for security alerts. `action`
    finishes the sentence "<name> ...", e.g. "made an API key". scope="function" runs the part after
    `yield` before the response, while the database connection is still open; an action that fails
    raises at the `yield`, so it is not announced."""

    def check(user: auth.User, conn: Conn, background: BackgroundTasks):
        mfa.require_fresh(user)
        yield
        body, chats = mfa.alert(conn, user, action)
        for chat in chats:
            background.add_task(notifications.send_telegram, chat, f"SOPBox security ({user.workspace_name}): {body}")

    return Depends(check, scope="function")


def _client(request: Request) -> str:
    return auth.client_address(request)


def _sign_in_limit(request: Request) -> None:
    """Every way in, per address: plenty for a shared kitchen, too few for guessing."""
    auth.limit("sign-in", _client(request), 60, 60)


SignInLimit = Depends(_sign_in_limit)


class ExtractRequest(BaseModel):
    # About 10 MB of image once base64 encoded. The frontend downsizes photos before sending.
    image_b64: str = Field(min_length=1, max_length=14_000_000)


def _error_handler(status_code: int, fixed_detail: str | None = None):
    async def handle(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse({"detail": fixed_detail or str(exc)}, status_code=status_code)

    return handle


# Plain names for the fields people type into, used in validation messages.
_FIELD_NAMES = {
    "username": "Username",
    "password": "Password",
    "new_password": "New password",
    "email": "Email",
    "workspace_name": "Business name",
    "display_name": "Name",
}


async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """One readable sentence per problem. FastAPI's default also echoes the submitted body back,
    which would put a password in the response, so only the messages are returned."""
    messages = []
    for err in exc.errors():
        message = str(err.get("msg", "invalid value")).removeprefix("Value error, ")
        field = next((str(p) for p in reversed(err.get("loc", ())) if isinstance(p, str) and p != "body"), "")
        if field in _FIELD_NAMES and err.get("type") != "value_error":
            message = f"{_FIELD_NAMES[field]}: {message[0].lower()}{message[1:]}"
        if message not in messages:
            messages.append(message)
    return JSONResponse({"detail": "; ".join(messages) or "the request is not valid"}, status_code=422)


app.add_exception_handler(RequestValidationError, _validation_error)


async def _unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    """A bug or an outage: say so plainly, keep the details in the server log (Replit's logs)."""
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        {"detail": "Something went wrong on our side. Please try again."},
        status_code=500,
        headers=SECURITY_HEADERS,
    )


app.add_exception_handler(Exception, _unexpected_error)


for _exc, _code in [
    (NotFoundError, 404),
    (ConflictError, 409),
    (InvalidRequestError, 422),
    (ExtractionError, 502),
    (RateLimitError, 429),
    (MfaRequiredError, 428),
    (AuthError, 401),
    (ForbiddenError, 403),
]:
    app.add_exception_handler(_exc, _error_handler(_code))
# Duplicate names, a category that still has products, a product that is on a delivery. Named by
# the constraint the database reports, so people see what to fix. Names follow PostgreSQL's
# defaults for the REFERENCES clauses in db.py.
_CONFLICTS = {
    "categories_name_key": "there is already a category with that name",
    "products_name_key": "there is already a product with that name",
    "products_category_id_fkey": "this category still has products: move or delete them first",
    "delivery_lines_product_id_fkey": "this product is on recorded deliveries, so it cannot be deleted: archive it instead",
    "purchase_order_lines_product_id_fkey": "this product is on purchase orders, so it cannot be deleted: archive it instead",
    "suppliers_name_key": "there is already a supplier with that name",
    "products_code_key": "another product already has that code",
    "products_barcode_key": "another product already has that barcode",
    "task_lists_name_key": "there is already a task list with that name",
    "outlets_name_key": "there is already an outlet with that name",
    "storages_name_key": "this outlet already has a storage area with that name",
    **dict.fromkeys(
        (
            "deliveries_storage_id_fkey",
            "stocktakes_storage_id_fkey",
            "stock_transfers_from_storage_id_fkey",
            "stock_transfers_to_storage_id_fkey",
            "sales_storage_id_fkey",
        ),
        "this storage area has deliveries, counts, transfers or sales on record, so it cannot be "
        "deleted: rename it instead",
    ),
}


async def _integrity_error(_: Request, exc: psycopg.IntegrityError) -> JSONResponse:
    detail = _CONFLICTS.get(exc.diag.constraint_name or "", "this conflicts with existing data")
    return JSONResponse({"detail": detail}, status_code=409)


app.add_exception_handler(psycopg.IntegrityError, _integrity_error)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ---- sign in, sign up -------------------------------------------------------------------------


def _me(conn: psycopg.Connection, user: CurrentUser) -> Me:
    return Me(
        previous_sign_in=auth.previous_sign_in(conn, user.id, user.sign_in_id),
        sign_in_method=auth.sign_in_method(conn, user.sign_in_id),
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        section_access=user.section_access,
        workspace=WorkspaceRef(id=user.workspace_id, public_id=user.workspace_public_id, name=user.workspace_name),
        mfa_enabled=user.mfa_enabled,
        mfa_pending=user.mfa_pending,
        mfa_setup_needed=not user.mfa_enabled and mfa.required(user.mfa_policy, user.role),
        can_export=export.allowed(user),
        outlet_id=user.outlet_id,
        assistant=user.assistant,
        closing=closing.state(conn, user.workspace_id),
        workspaces=[
            WorkspaceChoice(id=user.workspace_id, public_id=user.workspace_public_id, name=user.workspace_name, role=user.role),
            *(
                WorkspaceChoice(id=b.id, public_id=b.public_id, name=b.name, role=auth.in_branch(conn, user, b.id).role)
                for b in hq.links(conn, user.workspace_id).branches
            ),
        ],
    )


@app.post("/api/auth/register", response_model=Me, status_code=201)
def register(body: RegisterIn, request: Request, response: Response, conn: Conn):
    """Create a workspace. Whoever does this becomes its owner, with every permission."""
    auth.check_register_allowed(_client(request))
    user_id = accounts.register_workspace(conn, body)
    return _signed_in(conn, request, response, user_id, "register")


def _signed_in(
    conn: psycopg.Connection, request: Request, response: Response, user_id: int, method: str, **session
) -> Me:
    pending = auth.start_session(conn, request, response, user_id, method, **session)
    return _me(conn, replace(auth.get_me(conn, user_id), mfa_pending=pending)).model_copy(update={"sign_in_method": method})


@app.get("/api/auth/username-available", response_model=UsernameCheck)
def username_available(username: Annotated[str, Query(max_length=254)], request: Request, conn: Conn):
    """For the sign-up and profile forms, as the person types."""
    auth.check_username_lookup_allowed(_client(request))
    user = auth.optional_user(request, conn)
    return accounts.username_available(conn, username, user.id if user else None)


@app.post("/api/auth/login", dependencies=[SignInLimit], response_model=Me)
def login(body: LoginIn, request: Request, response: Response, conn: Conn):
    user_id = accounts.authenticate(conn, body.username, body.password)
    return _signed_in(conn, request, response, user_id, "password")


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, response: Response, conn: Conn) -> None:
    auth.end_session(conn, request, response)


def _signing_in(request: Request, conn: Conn) -> CurrentUser:
    """The signed-in user, even while the session still waits for an authenticator code."""
    user = auth.optional_user(request, conn)
    if user is None:
        raise AuthError("sign in to continue")
    auth.act_as(conn, user)
    return user


@app.post("/api/auth/mfa/setup", response_model=MfaSetupOut)
def mfa_setup(user: User, conn: Conn):
    return mfa.setup(conn, user)


@app.post("/api/auth/mfa/enable", response_model=MfaEnabledOut)
def mfa_enable(body: MfaCodeIn, user: User, conn: Conn):
    return mfa.enable(conn, user, body.code)


@app.post("/api/auth/mfa/verify", response_model=Me, dependencies=[SignInLimit])
def mfa_verify(body: MfaCodeIn, user: Annotated[CurrentUser, Depends(_signing_in)], conn: Conn):
    mfa.verify(conn, user, body.code)
    return _me(conn, replace(user, mfa_pending=False, mfa_fresh=True))


@app.post("/api/auth/mfa/backup-codes", response_model=MfaEnabledOut, dependencies=[dangerous("made new two-step backup codes")])
def mfa_backup_codes(user: User, conn: Conn):
    return mfa.new_backup_codes(conn, user)


@app.delete("/api/auth/mfa", status_code=204, dependencies=[dangerous("turned off two-step sign-in")])
def mfa_disable(user: User, conn: Conn) -> None:
    mfa.disable(conn, user)


@app.get("/api/auth/me", response_model=Me)
def me(user: User, conn: Conn):
    return _me(conn, user)


@app.get("/api/auth/session", response_model=Me | None)
def session(request: Request, conn: Conn):
    """Who is signed in, or null. Unlike /me, a signed-out visitor is not an error."""
    user = auth.optional_user(request, conn)
    return _me(conn, user) if user else None


@app.patch("/api/auth/me", dependencies=[dangerous("changed their profile")], response_model=Me)
def update_me(body: ProfileUpdateIn, user: User, conn: Conn):
    accounts.update_profile(conn, user, body)
    return _me(conn, auth.get_me(conn, user.id))


@app.post("/api/auth/password", dependencies=[dangerous("changed their password")], status_code=204)
def change_password(body: PasswordChangeIn, request: Request, user: User, conn: Conn) -> None:
    accounts.change_own_password(
        conn, user, body.current_password, body.new_password, request.cookies.get(auth.COOKIE)
    )


# ---- other ways to sign in: passkeys, Google, Telegram, kitchen tablet PIN -------------------


def _security_event(conn: psycopg.Connection, user: CurrentUser, detail: str) -> None:
    """Changes to how someone signs in go in the activity log."""
    audit_entry(conn, user.workspace_id, user.display_name, "user.sign_in_method", None, detail)


@app.get("/api/auth/methods", response_model=SignInMethods)
def sign_in_methods():
    return SignInMethods(google=sso.google_enabled(), telegram_bot_id=sso.telegram_bot_id())


@app.get("/api/auth/security", response_model=SecurityOut)
def my_security(user: User, conn: Conn):
    row = conn.execute(
        "SELECT google_sub IS NOT NULL AS google_linked, telegram_id IS NOT NULL AS telegram_linked, "
        "pin_hash IS NOT NULL AS pin_set FROM users WHERE id = %s",
        (user.id,),
    ).fetchone()
    recent = conn.execute(
        "SELECT id, at, method, device FROM sign_ins WHERE user_id = %s ORDER BY id DESC LIMIT 10", (user.id,)
    ).fetchall()
    group = team_group.link_for(conn, user.id)
    return SecurityOut(
        **row, passkeys=passkeys.list_passkeys(conn, user.id), recent_sign_ins=recent,
        team_group_title=group[0] if group else None, team_group_link=group[1] if group else None,
    )


@app.post("/api/auth/passkeys/register-options")
def passkey_register_options(request: Request, response: Response, user: User, conn: Conn) -> dict:
    return passkeys.registration_options(conn, request, response, user)


@app.post("/api/auth/passkeys", dependencies=[dangerous("added a passkey")], response_model=PasskeyOut, status_code=201)
def add_passkey(body: PasskeyRegisterIn, request: Request, response: Response, user: User, conn: Conn):
    added = passkeys.register(conn, request, response, user, body.credential, body.name)
    _security_event(conn, user, f"Added a passkey for {added.name}")
    return added


@app.delete("/api/auth/passkeys/{passkey_id}", dependencies=[dangerous("removed a passkey")], status_code=204)
def remove_passkey(passkey_id: int, user: User, conn: Conn) -> None:
    passkeys.remove(conn, user.id, passkey_id)
    _security_event(conn, user, "Removed a passkey")


@app.post("/api/auth/passkeys/login-options", dependencies=[SignInLimit])
def passkey_login_options(request: Request, response: Response, conn: Conn) -> dict:
    return passkeys.login_options(conn, request, response)


@app.post("/api/auth/passkeys/login", dependencies=[SignInLimit], response_model=Me)
def passkey_login(body: PasskeyLoginIn, request: Request, response: Response, conn: Conn):
    user_id = passkeys.login(conn, request, response, body.credential)
    return _signed_in(conn, request, response, user_id, "passkey")


@app.get("/api/auth/google/start", dependencies=[SignInLimit])
def google_start(request: Request, conn: Conn, mode: Literal["login", "link"] = "login"):
    """Send the browser to Google. Connecting ("link") needs the person to be signed in already."""
    back = "/settings" if mode == "link" else "/signin"
    user = auth.optional_user(request, conn)
    if not sso.google_enabled() or (mode == "link" and user is None):
        return RedirectResponse(f"{back}?auth_error=unavailable", status_code=303)
    redirect = RedirectResponse("", status_code=303)
    redirect.headers["location"] = sso.google_start(conn, request, redirect, mode, user)
    return redirect


@app.get("/api/auth/google/callback", dependencies=[SignInLimit])
def google_callback(request: Request, conn: Conn, code: str = "", state: str = ""):
    """Google sends the browser back here. Errors go back to the page as a short code, never as text."""
    redirect = RedirectResponse("/", status_code=303)
    try:
        flow = auth.take_flow(conn, request, redirect, "google")
    except AuthError:
        redirect.headers["location"] = "/signin?auth_error=google_expired"
        return redirect
    back = "/settings" if flow["mode"] == "link" else "/signin"
    if not code:  # the person pressed Cancel at Google
        redirect.headers["location"] = f"{back}?auth_error=google_cancelled"
        return redirect
    try:
        mode, user_id = sso.google_finish(conn, request, flow, code, state)
    except (ConflictError, AuthError) as err:
        reason = "taken" if isinstance(err, ConflictError) else "not_linked" if isinstance(err, sso.NotLinkedError) else "failed"
        redirect.headers["location"] = f"{back}?auth_error=google_{reason}"
        return redirect
    if mode == "link":
        # A redirect from Google, not a normal signed-in request: act as the person who started it.
        user = auth.get_me(conn, user_id)
        auth.act_as(conn, user)
        _security_event(conn, user, "Connected Google sign-in")
        redirect.headers["location"] = "/settings?linked=google"
    else:
        auth.start_session(conn, request, redirect, user_id, "google")
    return redirect


@app.post("/api/auth/telegram/login", dependencies=[SignInLimit], response_model=Me)
def telegram_login(body: TelegramAuthIn, request: Request, response: Response, conn: Conn):
    user_id = sso.telegram_login(conn, body.model_dump())
    return _signed_in(conn, request, response, user_id, "telegram")


@app.post("/api/auth/telegram/link", dependencies=[dangerous("linked Telegram sign-in")], status_code=204)
def telegram_link(body: TelegramAuthIn, request: Request, background: BackgroundTasks, user: User, conn: Conn) -> None:
    data = body.model_dump()
    sso.telegram_link(conn, user, data)
    if isinstance(data.get("username"), str):  # so an @mention in the team group finds them
        conn.execute("UPDATE users SET telegram_username = %s WHERE id = %s", (data["username"][:64], user.id))
    _security_event(conn, user, "Connected Telegram sign-in")
    _send_invites(background, [team_group.invite(conn, user.id)])
    background.add_task(team_group.ensure_webhook, _origin(request))
    background.add_task(send_telegram, str(body.id), f"Connected to SOPBox as {user.display_name}. Send /help to see what I can do.")


def _send_invites(background: BackgroundTasks, invites: list[tuple[str, str] | None]) -> None:
    """Team group links go out after the response, so a slow Telegram never holds up the page."""
    for invite in filter(None, invites):
        background.add_task(send_telegram, *invite)


@app.delete("/api/auth/kitchen", status_code=204)
def forget_kitchen_tablet(request: Request, response: Response, conn: Conn) -> None:
    """On a kitchen tablet: stop using this browser as one. Its people list is gone at once."""
    # Before /api/auth/{provider}, which would take this path otherwise.
    kitchen.forget(conn, request, response)


@app.delete("/api/auth/{provider}", dependencies=[dangerous("unlinked a sign-in method")], status_code=204)
def unlink_provider(provider: Literal["google", "telegram"], background: BackgroundTasks, user: User, conn: Conn) -> None:
    if provider == "telegram":
        # Out of the team group: that Telegram account is no longer known to be this person.
        old = conn.execute("SELECT telegram_id FROM users WHERE id = %s", (user.id,)).fetchone()["telegram_id"]
        if old:
            chat = accounts.get_workspace(conn, user.workspace_id).telegram_team_chat_id
            background.add_task(team_group.kick_quietly, chat, old, keep_out=False)
    sso.unlink(conn, user, provider)
    _security_event(conn, user, f"Disconnected {provider.title()} sign-in")


@app.put("/api/auth/pin", dependencies=[dangerous("changed their kitchen PIN")], status_code=204)
def set_pin(body: PinIn, user: User, conn: Conn) -> None:
    kitchen.set_pin(conn, user, body.pin)
    _security_event(conn, user, "Set a kitchen tablet PIN" if body.pin else "Removed their kitchen tablet PIN")


@app.get("/api/auth/kitchen", response_model=KitchenScreen | None)
def kitchen_screen(request: Request, conn: Conn):
    """On a kitchen tablet: who can sign in with a PIN. Null on any other browser."""
    return kitchen.screen(conn, request)


@app.post("/api/auth/kitchen/login", dependencies=[SignInLimit], response_model=Me)
def kitchen_login(body: KitchenLoginIn, request: Request, response: Response, conn: Conn):
    user_id = kitchen.login(conn, request, body.user_id, body.pin)
    return _signed_in(conn, request, response, user_id, "kitchen_pin", days=kitchen.SESSION_DAYS)


@app.get("/api/kitchen-devices", response_model=list[KitchenDeviceOut])
def list_kitchen_devices(request: Request, user: ManagerUp, conn: Conn):
    return kitchen.list_devices(conn, request, user.workspace_id)


@app.post("/api/kitchen-devices", dependencies=[dangerous("set up a kitchen tablet")], response_model=KitchenDeviceOut, status_code=201)
def add_kitchen_device(body: KitchenDeviceIn, response: Response, user: ManagerUp, conn: Conn):
    """Mark this browser as a kitchen tablet for the workspace."""
    device = kitchen.register_device(conn, response, user, body.name)
    _security_event(conn, user, f"Made {device.name} a kitchen tablet")
    return device


@app.delete("/api/kitchen-devices/{device_id}", dependencies=[dangerous("removed a kitchen tablet")], status_code=204)
def remove_kitchen_device(device_id: int, user: ManagerUp, conn: Conn) -> None:
    kitchen.remove_device(conn, user.workspace_id, device_id)
    _security_event(conn, user, "Removed a kitchen tablet")


# ---- owner: people and workspace settings -----------------------------------------------------


@app.get("/api/users", response_model=list[UserOut])
def list_users(user: ManagerUp, conn: Conn):
    """The owner sees everyone; an outlet's manager sees the people at their outlet."""
    return accounts.list_users(conn, user)


@app.post("/api/users", dependencies=[dangerous("added a person to the team")], response_model=UserOut, status_code=201)
def create_user(body: UserCreateIn, user: ManagerUp, conn: Conn):
    return accounts.create_user(conn, user, body)


@app.patch("/api/users/{user_id}", dependencies=[dangerous("changed a teammate's account")], response_model=UserOut)
def update_user(user_id: int, body: UserUpdateIn, background: BackgroundTasks, owner: ManagerUp, conn: Conn):
    was_active = accounts.get_user(conn, owner.workspace_id, user_id).active
    updated = accounts.update_user(conn, owner, user_id, body)
    if updated.active != was_active and updated.telegram_linked:
        # A disabled account leaves the team group; enabling it lets the person back in.
        chat = accounts.get_workspace(conn, owner.workspace_id).telegram_team_chat_id
        telegram_id = conn.execute("SELECT telegram_id FROM users WHERE id = %s", (user_id,)).fetchone()["telegram_id"]
        if updated.active:
            background.add_task(team_group.unban_quietly, chat, telegram_id)
            _send_invites(background, [team_group.invite(conn, user_id)])
        else:
            background.add_task(team_group.kick_quietly, chat, telegram_id, keep_out=True)
    return updated


@app.put("/api/workspace/team-group", dependencies=[dangerous("connected a Telegram team group")], response_model=WorkspaceSettings)
def connect_team_group(body: TeamGroupIn, request: Request, background: BackgroundTasks, owner: OwnerOnly, conn: Conn):
    """Connect the workspace's Telegram team group. Everyone with Telegram connected gets the link."""
    ws = team_group.connect(conn, owner, body.chat_id, _origin(request))
    _send_invites(background, team_group.invites_for_everyone(conn, owner.workspace_id))
    return ws


@app.delete("/api/workspace/team-group", dependencies=[dangerous("disconnected the Telegram team group")], response_model=WorkspaceSettings)
def disconnect_team_group(owner: OwnerOnly, conn: Conn):
    return team_group.disconnect(conn, owner)


@app.post("/api/users/{user_id}/team-group/remove", dependencies=[dangerous("removed a teammate from the Telegram team group")], response_model=UserOut)
def remove_from_team_group(user_id: int, body: TeamGroupRemoveIn, owner: OwnerOnly, conn: Conn):
    team_group.remove(conn, owner, user_id, body.hours)
    return accounts.get_user(conn, owner.workspace_id, user_id)


@app.post("/api/users/{user_id}/team-group/let-back", response_model=UserOut)
def let_back_into_team_group(user_id: int, background: BackgroundTasks, owner: OwnerOnly, conn: Conn):
    _send_invites(background, [team_group.let_back(conn, owner, user_id)])
    return accounts.get_user(conn, owner.workspace_id, user_id)


@app.post("/api/telegram/webhook", include_in_schema=False)
def telegram_webhook(request_body: dict, request: Request, background: BackgroundTasks, conn: Conn) -> dict:
    """Updates from Telegram (join requests to team groups). Only Telegram knows the secret."""
    sent = request.headers.get("x-telegram-bot-api-secret-token", "")
    if not get_settings().telegram_bot_token or not hmac.compare_digest(sent, team_group.webhook_secret()):
        raise AuthError("not from Telegram")
    team_group.handle_update(conn, request_body)
    if isinstance(request_body.get("message"), dict):
        # Answered after Telegram has its reply: reading a sentence can take the model a while, and
        # a slow webhook makes Telegram send the message again.
        background.add_task(_bot_message, request_body["message"])
    return {}


def _bot_message(message: dict) -> None:
    with contextmanager(get_db)() as conn:
        telegram_bot.handle_message(conn, message)


@app.get("/api/workspace", response_model=WorkspaceSettings)
def get_workspace(owner: OwnerOnly, request: Request, background: BackgroundTasks, conn: Conn):
    background.add_task(team_group.ensure_webhook, _origin(request))  # an existing bot learns about direct messages
    return accounts.get_workspace(conn, owner.workspace_id)


@app.patch("/api/workspace", dependencies=[dangerous("changed the workspace settings")], response_model=WorkspaceSettings)
def update_workspace(body: WorkspaceUpdateIn, owner: OwnerOnly, conn: Conn):
    return accounts.update_workspace(conn, owner, body)


# ---- limited dashboard summary -----------------------------------------------------------------


@app.get("/api/dashboard", response_model=DashboardSummary)
def dashboard_summary(user: DashboardReader, conn: Conn):
    ws = user.workspace_id
    product_count = conn.execute(
        "SELECT COUNT(*)::int AS count FROM products WHERE workspace_id = %s AND NOT archived",
        (ws,),
    ).fetchone()["count"]
    counts = {
        row["status"]: row["count"]
        for row in conn.execute(
            "SELECT status, COUNT(*)::int AS count FROM deliveries "
            f"WHERE workspace_id = %s AND {deliveries._OWN} GROUP BY status",
            (ws,),
        ).fetchall()
    }
    recent = conn.execute(
        "SELECT d.id, d.supplier, d.status, d.created_at, "
        "CASE WHEN po.number IS NULL THEN NULL ELSE 'PO-' || lpad(po.number::text, 4, '0') END AS purchase_order "
        "FROM deliveries d LEFT JOIN purchase_orders po ON po.id = d.purchase_order_id "
        f"WHERE d.workspace_id = %s AND {locations.mine('d.storage_id')} ORDER BY d.id DESC LIMIT 6",
        (ws,),
    ).fetchall()
    # With an outlet picked, low stock is what that outlet's storage areas hold against each minimum.
    low_stock = conn.execute(
        "SELECT * FROM (SELECT p.id, p.name, p.min_stock, p.base_unit, "
        f"CASE WHEN {locations.OWN_OUTLET} IS NULL THEN p.stock ELSE COALESCE(l.quantity, 0) END AS stock "
        "FROM products p LEFT JOIN (SELECT product_id, sum(quantity)::bigint AS quantity FROM stock_levels "
        f"WHERE {locations.mine('storage_id')} GROUP BY product_id) l ON l.product_id = p.id "
        "WHERE p.workspace_id = %s AND NOT p.archived) x WHERE stock < min_stock "
        "ORDER BY stock ASC, lower(name) LIMIT 100",
        (ws,),
    ).fetchall()
    since = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat(timespec="seconds")
    activity = conn.execute(
        f"SELECT created_at, status FROM deliveries WHERE workspace_id = %s AND {deliveries._OWN} AND created_at >= %s "
        "ORDER BY created_at, id LIMIT 5000",
        (ws, since),
    ).fetchall()
    return DashboardSummary(
        product_count=product_count,
        delivery_count=sum(counts.values()),
        pending_count=counts.get("pending_approval", 0),
        accepted_count=counts.get("accepted", 0),
        rejected_count=counts.get("rejected", 0),
        returned_count=counts.get("returned", 0),
        recent_deliveries=[DashboardDeliveryOut(**row) for row in recent],
        low_stock_products=[DashboardLowStockOut(**row) for row in low_stock],
        recent_activity=[DashboardDayOut(**row) for row in activity],
    )


# ---- catalogue (anyone signed in can read; owners and managers change it) ---------------------


@app.get("/api/categories", response_model=list[Category])
def list_categories(user: CatalogueReader, conn: Conn):
    return catalogue.list_categories(conn, user.workspace_id)


@app.post("/api/categories", response_model=Category, status_code=201)
def create_category(body: CategoryIn, user: ProductEditor, conn: Conn):
    return catalogue.create_category(conn, user.workspace_id, body)


@app.put("/api/categories/{category_id}", response_model=Category)
def update_category(category_id: int, body: CategoryIn, user: ProductEditor, conn: Conn):
    return catalogue.update_category(conn, user.workspace_id, category_id, body)


@app.delete("/api/categories/{category_id}", dependencies=[dangerous("deleted a category")], status_code=204)
def delete_category(category_id: int, user: ProductEditor, conn: Conn) -> None:
    catalogue.delete_category(conn, user.workspace_id, category_id)


@app.get("/api/products", response_model=list[Product])
def list_products(user: CatalogueReader, conn: Conn, q: str | None = Query(default=None, max_length=100)):
    """All products. `q` searches name, category and SOP text: this is the SOP lookup."""
    return catalogue.list_products(conn, user.workspace_id, q)


@app.get("/api/products/{product_id}", response_model=Product)
def get_product(product_id: int, user: CatalogueReader, conn: Conn):
    return catalogue.get_product(conn, user.workspace_id, product_id)


@app.post("/api/products", response_model=Product, status_code=201)
def create_product(body: ProductIn, user: ProductEditor, conn: Conn):
    return catalogue.create_product(conn, user.workspace_id, body)


@app.put("/api/products/{product_id}", response_model=Product)
def update_product(product_id: int, body: ProductIn, user: ProductEditor, conn: Conn):
    return catalogue.update_product(conn, user.workspace_id, product_id, body)


@app.post("/api/products/bulk", dependencies=[dangerous("imported products from a sheet")], response_model=list[Product], status_code=201)
def create_products(body: ProductsBulkIn, user: ProductEditor, conn: Conn):
    """Add several reviewed products together: all of them, or none if one is not valid."""
    return catalogue.create_products(conn, user.workspace_id, body.products)


@app.post("/api/products/read-sheet", response_model=list[ProductSuggestionOut])
def read_product_sheet(body: ExtractRequest, user: ProductEditor, conn: Conn):
    """Read a supplier's product list or SOP sheet into suggestions. Nothing is saved here."""
    categories = {c.name.lower(): c.id for c in catalogue.list_categories(conn, user.workspace_id)}
    names = {p.name.lower() for p in catalogue.list_products(conn, user.workspace_id)}
    return [
        ProductSuggestionOut(
            **s.model_dump(),
            category_id=categories.get((s.category or "").lower()),
            exists=s.name.lower() in names,
        )
        for s in plans.metered(conn, user.workspace_id, "products", lambda: extract_products(body.image_b64))
    ]


@app.post("/api/products/sop-draft", response_model=SopDraft)
def draft_sop(body: SopDraftIn, user: ProductEditor, conn: Conn):
    """AI writes an SOP from the manager's notes and a second pass checks it. Nothing is saved here."""
    category = catalogue.get_category(conn, user.workspace_id, body.category_id)
    low, high = (
        (body.temp_min_c, body.temp_max_c) if body.temp_min_c is not None
        else (category.temp_min_c, category.temp_max_c)
    )
    facts = {
        "name": body.name,
        "category": category.name,
        "arrival_temperature_c": None if low is None else f"{low:g} to {high:g}",
        "counted_in": body.base_unit,
        "pack_sizes": [f"1 {p.unit} = {p.base_qty} {body.base_unit}" for p in body.pack_units],
    }
    return plans.metered(conn, user.workspace_id, "sop", lambda: write_sop(facts, body.notes))


@app.patch("/api/products/{product_id}", response_model=Product)
def archive_product(product_id: int, body: ArchiveIn, user: ProductEditor, conn: Conn):
    """Archive (or restore) a product: it leaves receiving but keeps its delivery history."""
    return catalogue.set_archived(conn, user.workspace_id, product_id, body.archived)


@app.delete("/api/products/{product_id}", dependencies=[dangerous("archived a product")], status_code=204)
def delete_product(product_id: int, user: ProductEditor, conn: Conn) -> None:
    catalogue.delete_product(conn, user.workspace_id, product_id)


# ---- purchasing: suppliers and purchase orders ------------------------------------------------
# Anyone signed in can read them (staff receive against issued orders); managers write.


@app.get("/api/suppliers", response_model=list[Supplier])
def list_suppliers(user: PurchasingReader, conn: Conn):
    return purchasing.list_suppliers(conn, user.workspace_id)


@app.post("/api/suppliers", response_model=Supplier, status_code=201)
def create_supplier(body: SupplierIn, user: PurchasingEditor, conn: Conn):
    return purchasing.create_supplier(conn, user.workspace_id, body)


@app.put("/api/suppliers/{supplier_id}", response_model=Supplier)
def update_supplier(supplier_id: int, body: SupplierIn, user: PurchasingEditor, conn: Conn):
    return purchasing.update_supplier(conn, user.workspace_id, supplier_id, body)


@app.patch("/api/suppliers/{supplier_id}", response_model=Supplier)
def archive_supplier(supplier_id: int, body: ArchiveIn, user: PurchasingEditor, conn: Conn):
    return purchasing.set_supplier_archived(conn, user.workspace_id, supplier_id, body.archived)


@app.get("/api/purchase-orders", response_model=list[PurchaseOrder])
def list_purchase_orders(
    user: PurchasingReader, conn: Conn, status: Literal["draft", "issued", "cancelled"] | None = None
):
    if (
        user.role == "staff"
        and not auth.can_access_section(user, "purchasing")
        and status not in (None, "issued")
    ):
        raise ForbiddenError("receiving staff can only view issued purchase orders")
    if user.role == "staff" and not auth.can_access_section(user, "purchasing"):
        status = "issued"
    return purchasing.list_orders(conn, user.workspace_id, status)


@app.get("/api/purchase-orders/low-stock-suppliers", response_model=list[LowStockSupplier])
def low_stock_suppliers(user: PurchasingEditor, conn: Conn):
    """Who Draft from low stock can order from right now, and what each would get."""
    return purchasing.low_stock_suppliers(conn, user.workspace_id)


@app.get("/api/purchase-orders/reorder-suggestions", response_model=list[ReorderSuggestion])
def reorder_suggestions(user: PurchasingEditor, conn: Conn):
    """What Draft from low stock would order and why: the minimum plus a week of recent use."""
    return purchasing.reorder_suggestions(conn, user.workspace_id)[0]


@app.get("/api/purchase-orders/{order_id}", response_model=PurchaseOrder)
def get_purchase_order(order_id: int, user: PurchasingReader, conn: Conn):
    order = purchasing.get_order(conn, user.workspace_id, order_id)
    if (
        user.role == "staff"
        and not auth.can_access_section(user, "purchasing")
        and order.status != "issued"
    ):
        raise NotFoundError("purchase order not found")
    return order


@app.post("/api/purchase-orders", response_model=PurchaseOrder, status_code=201)
def create_purchase_order(body: PurchaseOrderIn, user: PurchasingEditor, conn: Conn):
    return purchasing.create_order(conn, user.workspace_id, user.display_name, body)


@app.post("/api/purchase-orders/low-stock-draft", response_model=PurchaseOrder, status_code=201)
def draft_from_low_stock(body: LowStockDraftIn, user: PurchasingEditor, conn: Conn):
    return purchasing.low_stock_draft(conn, user.workspace_id, user.display_name, body)


@app.put("/api/purchase-orders/{order_id}", response_model=PurchaseOrder)
def update_purchase_order(order_id: int, body: PurchaseOrderIn, user: PurchasingEditor, conn: Conn):
    return purchasing.update_order(conn, user.workspace_id, user.display_name, order_id, body)


@app.post("/api/purchase-orders/{order_id}/issue", response_model=PurchaseOrder)
def issue_purchase_order(order_id: int, user: PurchasingEditor, conn: Conn):
    return purchasing.issue_order(conn, user.workspace_id, user.display_name, order_id)


@app.post("/api/purchase-orders/{order_id}/cancel", response_model=PurchaseOrder)
def cancel_purchase_order(order_id: int, body: CancelIn, user: PurchasingEditor, conn: Conn):
    return purchasing.cancel_order(conn, user.workspace_id, user.display_name, order_id, body.reason)


# ---- receiving journey ------------------------------------------------------------------------


@app.post("/api/extract", response_model=list[ExtractedLineOut])
def extract(body: ExtractRequest, user: ReceivingEditor, conn: Conn):
    """Read an order photo. Staff must confirm every line before submitting the delivery."""
    products = catalogue.list_products(conn, user.workspace_id, active_only=True)
    return [
        ExtractedLineOut(**line.model_dump(), product_id=catalogue.match_product(line.name, products))
        for line in plans.metered(conn, user.workspace_id, "delivery", lambda: extract_lines(body.image_b64))
    ]


@app.post("/api/deliveries", response_model=Delivery, status_code=201)
def create_delivery(body: DeliveryIn, background: BackgroundTasks, user: ReceivingEditor, conn: Conn):
    delivery = deliveries.create_delivery(conn, user.workspace_id, user, body)
    if delivery.status == "pending_approval":
        chat = accounts.get_workspace(conn, user.workspace_id).telegram_manager_chat_id
        background.add_task(send_telegram, chat, approval_needed_message(delivery))
    return delivery


@app.get("/api/deliveries", response_model=list[Delivery])
def list_deliveries(
    user: DeliveryReader,
    conn: Conn,
    status: DeliveryStatus | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    return deliveries.list_deliveries(conn, user.workspace_id, status, limit)


@app.get("/api/deliveries/{delivery_id}", response_model=Delivery)
def get_delivery(delivery_id: int, user: DeliveryReader, conn: Conn):
    return deliveries.get_delivery(conn, user.workspace_id, delivery_id)


@app.get("/api/deliveries/{delivery_id}/photos/{photo_id}")
def delivery_photo(delivery_id: int, photo_id: int, user: DeliveryReader, conn: Conn):
    data = deliveries.get_photo(conn, user.workspace_id, delivery_id, photo_id)
    # A photo never changes once saved, so the browser may keep it; private because it needs a login.
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.post("/api/deliveries/{delivery_id}/photos/{photo_id}/comments", response_model=Delivery, status_code=201)
def comment_on_photo(delivery_id: int, photo_id: int, body: PhotoCommentIn, user: DeliveryReader, conn: Conn):
    """Anyone who can see the delivery can discuss its photos; the decision itself stays with approvers."""
    return deliveries.comment_on_photo(conn, user.workspace_id, delivery_id, photo_id, user, body)


@app.post("/api/deliveries/{delivery_id}/decision", response_model=Delivery)
def decide(
    delivery_id: int, body: DecisionIn, background: BackgroundTasks, user: ApprovalsEditor, conn: Conn
):
    delivery = deliveries.decide(conn, user.workspace_id, delivery_id, user, body)
    chat = accounts.get_workspace(conn, user.workspace_id).telegram_staff_chat_id
    background.add_task(send_telegram, chat, decision_message(delivery))
    return delivery


@app.post("/api/deliveries/{delivery_id}/tags", response_model=Delivery)
def tag_teammates(delivery_id: int, body: TagsIn, user: DeliveryReader, conn: Conn):
    """Anyone who can see the delivery can tag a teammate on it; each one is told in their inbox."""
    return deliveries.add_tags(conn, user.workspace_id, delivery_id, user, body.user_ids)


@app.delete("/api/deliveries/{delivery_id}/tags/{user_id}", response_model=Delivery)
def untag_teammate(delivery_id: int, user_id: int, user: DeliveryReader, conn: Conn):
    return deliveries.remove_tag(conn, user.workspace_id, delivery_id, user, user_id)


@app.get("/api/audit", response_model=list[AuditEntry])
def audit(
    user: ActivityReader,
    conn: Conn,
    limit: int = Query(default=50, ge=1, le=200),
    actor_id: int | None = None,
):
    return deliveries.list_audit(conn, user.workspace_id, limit, actor_id)


# ---- teammates, inbox and accountability -------------------------------------------------------


@app.get("/api/team", response_model=list[TeamMember])
def list_team(user: User, conn: Conn):
    """Active teammates' names, for tagging. Everyone in the workspace may see who else is in it."""
    return inbox.team(conn, user.workspace_id)


@app.get("/api/team/accountability", response_model=list[Accountability])
def team_accountability(owner: OwnerOnly, conn: Conn):
    return inbox.accountability(conn, owner.workspace_id)


@app.get("/api/team/efficiency", response_model=list[Efficiency])
def team_efficiency(user: ManagerUp, conn: Conn, days: int = Query(30, ge=7, le=365)):
    return efficiency.team(conn, user.workspace_id, days)


@app.get("/api/inbox", response_model=Inbox)
def get_inbox(user: User, conn: Conn, limit: int = Query(default=30, ge=1, le=100)):
    return inbox.inbox(conn, user.workspace_id, user.id, limit)


@app.post("/api/inbox/read", status_code=204)
def read_inbox(body: NotificationsReadIn, user: User, conn: Conn) -> None:
    inbox.mark_read(conn, user.workspace_id, user.id, body.ids)


# ---- blind stock counts ------------------------------------------------------------------------


@app.get("/api/stocktakes/template.xlsx")
def download_stocktake_template(user: StocktakeReader, conn: Conn):
    return Response(
        content=stocktakes.build_template(conn, user.workspace_id),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="stock-count-template.xlsx"'},
    )


@app.get("/api/stocktakes/products", response_model=list[StocktakeProductOut])
def list_stocktake_products(user: StocktakeReader, conn: Conn, storage_id: int | None = None):
    return stocktakes.list_products(conn, user.workspace_id, storage_id)


@app.post("/api/stocktakes/preview", response_model=StocktakePreview)
async def preview_stocktake(
    file: Annotated[UploadFile, File()],
    user: StocktakeReader,
    conn: Conn,
    storage_id: int | None = None,
):
    content = await file.read(stocktakes.MAX_UPLOAD_BYTES + 1)
    return StocktakePreview(
        lines=stocktakes.preview_import(conn, user.workspace_id, file.filename or "", content, storage_id)
    )


@app.get("/api/stocktakes", response_model=list[StocktakeOut])
def list_stocktakes(user: StocktakeReader, conn: Conn):
    return stocktakes.list_stocktakes(conn, user.workspace_id)


@app.post("/api/stocktakes", response_model=StocktakeDetail, status_code=201)
def create_stocktake(body: StocktakeCreateIn, user: StocktakeEditor, conn: Conn):
    return stocktakes.create_stocktake(conn, user.workspace_id, user.display_name, body, user.id)


@app.get("/api/stocktakes/{stocktake_id}", response_model=StocktakeDetail)
def get_stocktake(stocktake_id: int, user: StocktakeReader, conn: Conn):
    return stocktakes.get_stocktake(conn, user.workspace_id, stocktake_id)


@app.get("/api/insights/price-changes", response_model=list[PriceChange])
def price_changes(user: PurchasingReader, conn: Conn):
    """Delivered prices that moved by 10% or more in the last 30 days."""
    return insights.price_changes(conn, user.workspace_id)


@app.post("/api/ask", response_model=AskAnswer)
def ask_helper(body: AskIn, user: User, conn: Conn):
    """A question to the helper, answered from the records the asker can see."""
    return ask.answer(conn, user, body.question)


@app.post("/api/assistant", response_model=AssistantOut)
def assistant_chat(body: AssistantIn, user: User, conn: Conn):
    """The assistant: answers from the records the asker can see, and buttons to the page for the next step."""
    auth.limit("assistant", str(user.workspace_id), 120, 3600)  # each question may call the paid AI
    return assistant.chat(conn, user, body)


@app.get("/api/stocktakes/{stocktake_id}/insights", response_model=CountInsights)
def stocktake_insights(stocktake_id: int, user: StocktakeReader, conn: Conn):
    """The count's gaps, with how each product counted before and what to check."""
    return insights.count_insights(conn, user.workspace_id, stocktake_id)


@app.post("/api/stocktakes/{stocktake_id}/explain", response_model=GapExplanation)
def explain_stocktake(stocktake_id: int, user: StocktakeReader, conn: Conn):
    """The model's reading of the gaps, from the numbers above. Nothing is saved."""
    found = insights.count_insights(conn, user.workspace_id, stocktake_id)
    if not found.gaps:
        raise InvalidRequestError("nothing to explain: every product matched")
    return plans.metered(conn, user.workspace_id, "explain", lambda: explain_gaps({
        "sales_recorded": found.sales_recorded,
        "products": [
            g.model_dump(include={"product_name", "base_unit", "expected_stock", "counted_stock", "difference", "earlier", "pattern"})
            for g in found.gaps[:15]
        ],
    }))


# ---- outlets, storage areas, transfers and sales -------------------------------------------------


@app.get("/api/tasks", response_model=list[TaskList])
def list_tasks(user: User, conn: Conn, day: date = Query()):
    """The task lists this person's role sees, with the steps ticked on `day` (the phone's date)."""
    return tasks.list_tasks(conn, user, day)


@app.post("/api/tasks", response_model=TaskList, status_code=201)
def create_task_list(body: TaskListIn, user: ManagerUp, conn: Conn):
    return tasks.create_list(conn, user, body)


@app.put("/api/tasks/{list_id}", response_model=TaskList)
def update_task_list(list_id: int, body: TaskListIn, user: ManagerUp, conn: Conn):
    return tasks.update_list(conn, user, list_id, body)


@app.delete("/api/tasks/{list_id}", status_code=204)
def delete_task_list(list_id: int, user: ManagerUp, conn: Conn) -> None:
    tasks.delete_list(conn, user, list_id)


@app.post("/api/tasks/{list_id}/ticks", response_model=TaskList)
def tick_task(list_id: int, body: TickIn, user: User, conn: Conn):
    return tasks.tick(conn, user, list_id, body)


@app.get("/api/jobs", response_model=list[Job])
def list_jobs(user: User, conn: Conn, day: date = Query()):
    """Open orders, held deliveries and planned counts, with their PICs and what to do on `day`."""
    return assignments.jobs(conn, user, day)


@app.post("/api/jobs/{kind}/{ref_id}/ticks", status_code=204)
def tick_job(kind: JobKind, ref_id: int, body: JobTickIn, user: User, conn: Conn):
    assignments.tick(conn, user, kind, ref_id, body)


@app.post("/api/assignments", response_model=AssignOut)
def assign(body: AssignIn, user: User, conn: Conn):
    """Make someone PIC. Anyone may add themselves when allowed; otherwise it becomes a request."""
    return assignments.assign(conn, user, body)


@app.delete("/api/assignments/{kind}/{ref_id}/{user_id}", status_code=204)
def unassign(kind: JobKind, ref_id: int, user_id: int, user: User, conn: Conn) -> None:
    assignments.unassign(conn, user, kind, ref_id, user_id)


@app.get("/api/assignment-requests", response_model=list[AssignmentRequest])
def list_assignment_requests(user: ManagerUp, conn: Conn):
    return assignments.requests(conn, user.workspace_id)


@app.post("/api/assignment-requests/{request_id}/decision", status_code=204)
def decide_assignment_request(request_id: int, body: RequestDecisionIn, user: ManagerUp, conn: Conn) -> None:
    assignments.decide(conn, user, request_id, body.approve)


@app.post("/api/count-plans", status_code=204)
def plan_count(body: CountPlanIn, user: ManagerUp, conn: Conn) -> None:
    assignments.plan_count(conn, user, body)


@app.delete("/api/count-plans/{plan_id}", status_code=204)
def unplan_count(plan_id: int, user: ManagerUp, conn: Conn) -> None:
    assignments.unplan_count(conn, user, plan_id)


@app.get("/api/outlets", response_model=list[OutletOut])
def list_outlets(user: User, conn: Conn):
    """Everyone picks storage areas (receiving, counting), so everyone may list them."""
    return locations.list_outlets(conn, user.workspace_id, auth.tied_outlet(user))


@app.post("/api/outlets", response_model=list[OutletOut], status_code=201)
def create_outlet(body: NameIn, user: ManagerUp, conn: Conn):
    return locations.create_outlet(conn, user.workspace_id, user.display_name, body.name)


@app.put("/api/outlets/{outlet_id}", response_model=list[OutletOut])
def rename_outlet(outlet_id: int, body: NameIn, user: ManagerUp, conn: Conn):
    return locations.rename_outlet(conn, user.workspace_id, user.display_name, outlet_id, body.name)


@app.delete("/api/outlets/{outlet_id}", dependencies=[dangerous("deleted an outlet")], response_model=list[OutletOut])
def delete_outlet(outlet_id: int, user: ManagerUp, conn: Conn):
    return locations.delete_outlet(conn, user.workspace_id, user.display_name, outlet_id)


@app.post("/api/storages", response_model=list[OutletOut], status_code=201)
def create_storage(body: StorageIn, user: ManagerUp, conn: Conn):
    return locations.create_storage(conn, user.workspace_id, user.display_name, body.outlet_id, body.name)


@app.put("/api/storages/{storage_id}", response_model=list[OutletOut])
def rename_storage(storage_id: int, body: NameIn, user: ManagerUp, conn: Conn):
    return locations.rename_storage(conn, user.workspace_id, user.display_name, storage_id, body.name)


@app.delete("/api/storages/{storage_id}", dependencies=[dangerous("deleted a storage area")], response_model=list[OutletOut])
def delete_storage(storage_id: int, user: ManagerUp, conn: Conn):
    return locations.delete_storage(conn, user.workspace_id, user.display_name, storage_id)


@app.get("/api/storages/{storage_id}/stock", response_model=list[StockLevelOut])
def stock_in_storage(storage_id: int, user: StocktakeReader, conn: Conn):
    return locations.stock_in(conn, user.workspace_id, storage_id)


@app.get("/api/transfers", response_model=list[TransferOut])
def list_transfers(user: StocktakeReader, conn: Conn):
    return locations.list_transfers(conn, user.workspace_id)


@app.get("/api/lots", response_model=list[LotOut])
def list_lots(user: StocktakeReader, conn: Conn):
    return lots.list_lots(conn, user.workspace_id)


@app.put("/api/lots/{lot_id}/expiry", response_model=LotOut)
def set_lot_expiry(lot_id: int, body: LotExpiryIn, user: StocktakeEditor, conn: Conn):
    return lots.set_expiry(conn, user.workspace_id, lot_id, body.expiry_on, user.display_name)


@app.post("/api/lots/{lot_id}/dispose", response_model=DisposalOut, status_code=201)
def dispose_lot(lot_id: int, body: DisposeIn, user: StocktakeEditor, conn: Conn):
    return lots.dispose(conn, user.workspace_id, lot_id, body, user.display_name)


@app.get("/api/disposals", response_model=list[DisposalOut])
def list_disposals(user: StocktakeReader, conn: Conn):
    return lots.list_disposals(conn, user.workspace_id)


@app.post("/api/transfers", response_model=TransferOut, status_code=201)
def create_transfer(body: TransferIn, user: StocktakeEditor, conn: Conn):
    return locations.create_transfer(conn, user.workspace_id, user.display_name, body)


@app.get("/api/sales/template.csv")
def download_sales_template(user: StocktakeReader, conn: Conn):
    return Response(
        content=sales.template_csv(conn, user.workspace_id),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="sales-template.csv"'},
    )


@app.get("/api/sales/template.xlsx")
def download_sales_sheet(user: StocktakeReader, conn: Conn, storage_id: Annotated[int | None, Query()] = None):
    return Response(
        content=sales.build_template(conn, user.workspace_id, storage_id),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="sales-sheet.xlsx"'},
    )


@app.post("/api/sales/preview", response_model=SalePreview)
async def preview_sales(
    file: Annotated[UploadFile, File()],
    storage_id: Annotated[int, Query()],
    user: StocktakeEditor,
    conn: Conn,
):
    content = await file.read(stocktakes.MAX_UPLOAD_BYTES + 1)
    return sales.preview(conn, user.workspace_id, storage_id, file.filename or "", content)


@app.post("/api/sales/read", response_model=SalesDraft)
def read_sales(body: SalesReadIn, user: StocktakeEditor, conn: Conn):
    """Read sales from a file, pasted text or a kept till sale, and match them to products. Saves nothing."""
    if (body.items is None and body.draft_id is None) or body.answers:
        auth.limit("sales-read", str(user.workspace_id), 60, 3600)  # each may call the paid AI
    return sales_ai.read(conn, user.workspace_id, body)


@app.post("/api/sales/confirm", response_model=SaleOut, status_code=201)
def confirm_sales(body: SalesConfirmIn, user: StocktakeEditor, conn: Conn):
    return sales_ai.confirm(conn, user.workspace_id, user.display_name, body)


@app.get("/api/sales/drafts", response_model=list[SaleDraftOut])
def list_sale_drafts(user: StocktakeReader, conn: Conn):
    """Till sales with items nothing matched yet, waiting for a person."""
    return sales_ai.list_drafts(conn, user.workspace_id)


@app.get("/api/sales", response_model=list[SaleOut])
def list_sales(user: StocktakeReader, conn: Conn):
    return sales.list_sales(conn, user.workspace_id)


@app.post("/api/sales", dependencies=[dangerous("recorded uploaded sales")], response_model=SaleOut, status_code=201)
def create_sale(body: SaleIn, user: StocktakeEditor, conn: Conn):
    return sales.create_sale(conn, user.workspace_id, user.display_name, body)


# ---- HQ and branches ----------------------------------------------------------------------------


@app.get("/api/workspace/links", response_model=LinksOut)
def workspace_links(owner: OwnerOnly, conn: Conn):
    return hq.links(conn, owner.workspace_id)


@app.post("/api/workspace/link-codes", dependencies=[dangerous("made an HQ branch link code")], response_model=LinkCodeOut, status_code=201)
def create_link_code(owner: OwnerOnly, conn: Conn):
    return hq.create_code(conn, owner)


@app.post("/api/workspace/hq", dependencies=[dangerous("linked this workspace to an HQ")], response_model=LinksOut)
def join_hq(body: LinkCodeIn, owner: OwnerOnly, conn: Conn):
    return hq.join(conn, owner, body.code)


@app.delete("/api/workspace/hq", dependencies=[dangerous("unlinked this workspace from its HQ")], response_model=LinksOut)
def leave_hq(owner: OwnerOnly, conn: Conn):
    return hq.leave(conn, owner)


@app.delete("/api/workspace/branches/{branch_id}", dependencies=[dangerous("unlinked a branch")], response_model=LinksOut)
def remove_branch(branch_id: int, owner: OwnerOnly, conn: Conn):
    return hq.remove_branch(conn, owner, branch_id)


# ---- API keys, and the two things a till can do with one ------------------------------------------


@app.get("/api/api-keys", response_model=list[ApiKeyOut])
def list_api_keys(user: ManagerUp, conn: Conn):
    return apikeys.list_keys(conn, user.workspace_id)


@app.post("/api/api-keys", dependencies=[dangerous("made an API key for the till")], response_model=ApiKeyCreated, status_code=201)
def create_api_key(body: ApiKeyIn, user: ManagerUp, conn: Conn):
    return apikeys.create_key(conn, user, body)


@app.delete("/api/api-keys/{key_id}", dependencies=[dangerous("revoked an API key")], response_model=list[ApiKeyOut])
def revoke_api_key(key_id: int, user: ManagerUp, conn: Conn):
    return apikeys.revoke_key(conn, user, key_id)


KeyClient = Annotated[apikeys.KeyClient, Depends(apikeys.key_client)]


@app.get("/api/v1/stock", response_model=list[StockLevelOut])
def api_stock(client: KeyClient, conn: Conn):
    """Stock in the key's storage area."""
    return locations.stock_in(conn, client.workspace_id, client.storage_id)


@app.post("/api/v1/sales", response_model=ApiSaleOut, status_code=201)
def api_record_sale(body: ApiSaleIn, client: KeyClient, conn: Conn):
    """Record a sale from the key's storage area, by product code."""
    return apikeys.record_sale(conn, client, body)


@app.post("/api/v1/sales/items", response_model=ApiSoldItemsOut, status_code=201)
def api_record_sold_items(body: ApiSoldItemsIn, client: KeyClient, conn: Conn):
    """Record a sale by item name. Items with no product or saved match wait for a person on Stock & sales."""
    return sales_ai.from_till(conn, client.workspace_id, client.storage_id, f"API key {client.name}", body)


# ---- reports ----------------------------------------------------------------------------------


@app.get("/api/reports/{kind}", response_model=ReportOut)
def report(kind: ReportKind, user: ManagerUp, conn: Conn, f: Annotated[ReportFilter, Query()]):
    """One report over the outlet worked in, filtered by period, product, supplier and storage area."""
    return reports.build(conn, user.workspace_id, kind, f)


# ---- exporting your data ----------------------------------------------------------------------


@app.get("/api/export", dependencies=[dangerous("downloaded a copy of the workspace's data")])
def export_data(user: User, conn: Conn):
    """The owner, and whoever they allowed: their own account, and the sections they can see, as one ZIP."""
    if not export.allowed(user):
        raise ForbiddenError("ask your owner to let you download data")
    auth.limit("export", str(user.id), 10, 3600)
    name, content = export.build(conn, user)
    return Response(content, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---- closing the business --------------------------------------------------------------------------


@app.post("/api/workspace/close", response_model=ClosingOut, dependencies=[dangerous("closed the business")])
def close_workspace(body: CloseIn, owner: OwnerOnly, conn: Conn):
    """Read-only now, deleted for good after closing.GRACE_DAYS unless the owner reopens it."""
    return closing.close(conn, owner, body.workspace_name)


@app.post("/api/workspace/reopen", response_model=ClosingOut, dependencies=[dangerous("reopened the business")])
def reopen_workspace(owner: OwnerOnly, conn: Conn):
    return closing.reopen(conn, owner)


# ---- SOPBox support only (ops.py) ------------------------------------------------------------------


# {workspace} is the Workspace ID the customer sees in Settings, or the internal number.
@app.get("/api/ops/workspaces/{workspace}", response_model=OpsWorkspaceOut, dependencies=[ops.Ops], include_in_schema=False)
def ops_workspace(workspace: str, conn: Conn):
    return ops.workspace(conn, ops.resolve(conn, workspace))


@app.post("/api/ops/workspaces/{workspace}/owner", response_model=OpsWorkspaceOut, dependencies=[ops.Ops], include_in_schema=False)
def ops_transfer_owner(workspace: str, body: OwnerTransferIn, conn: Conn):
    """Hand the workspace to another member, after support has checked who is asking."""
    return ops.transfer_owner(conn, ops.resolve(conn, workspace), body)


# ---- plans, sales enquiries and support -----------------------------------------------------------


@app.get("/api/pricing", response_model=PricingOut)
def pricing():
    """Public: prices, the donation link and how to reach sales."""
    return plans.pricing()


@app.get("/api/setup", response_model=SetupOut)
def setup_progress(owner: OwnerOnly, conn: Conn):
    return locations.setup_progress(conn, owner.workspace_id)


@app.get("/api/plan", response_model=PlanOut)
def current_plan(user: User, conn: Conn):
    return plans.current(conn, user.workspace_id)


@app.post("/api/inquiries", response_model=InquiryOut, status_code=201)
def sales_inquiry(body: SalesInquiryIn, request: Request, conn: Conn):
    """Public: a sales enquiry or a question from the contact page. The team contacts them."""
    auth.limit("inquiry", _client(request), 5, 3600)
    return inquiries.sales(conn, body)


@app.post("/api/plan/redeem", response_model=PlanOut)
def redeem_plan_code(body: PlanCodeIn, request: Request, owner: OwnerOnly, conn: Conn):
    """The owner enters a code from the SOPBox team to turn Pro on."""
    auth.limit("plan-code", f"{owner.workspace_id}:{_client(request)}", 10, 3600)
    return plans.redeem(conn, owner, body.code)


@app.post("/api/plan/upgrade-request", response_model=InquiryOut, status_code=201)
def upgrade_request(body: UpgradeRequestIn, owner: OwnerOnly, conn: Conn):
    return inquiries.upgrade(conn, owner, body)


@app.post("/api/support", response_model=InquiryOut, status_code=201)
def support_request(body: SupportIn, user: User, conn: Conn):
    auth.limit("support", str(user.id), 10, 3600)
    return inquiries.support(conn, user, body)


# ---- pages for browsers and search engines ---------------------------------------------------


def _origin(request: Request) -> str:
    """This site's address, e.g. https://sopbox.replit.app. uvicorn runs with --proxy-headers, so
    behind Replit's proxy this is the public https address."""
    return str(request.base_url).rstrip("/")


@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
@app.get("/signin", include_in_schema=False)
@app.get("/register", include_in_schema=False)
@app.get("/pricing", include_in_schema=False)
@app.get("/privacy", include_in_schema=False)
@app.get("/contact", include_in_schema=False)
@app.get("/docs", include_in_schema=False)
@app.get("/settings", include_in_schema=False)  # where connecting Google or Telegram comes back to
def index(request: Request):
    """The app's single page, with this address's title, description and canonical link (seo.py)."""
    page = FRONTEND_DIST / "index.html"
    if not page.is_file():
        return PlainTextResponse("Frontend not built. Run npm run build in src/frontend.", status_code=503)
    body = seo.render(page.read_text(encoding="utf-8"), request.url.path, _origin(request))
    # Always fetch the page fresh, so a new deploy's script and style names are picked up.
    return HTMLResponse(body, headers={"Cache-Control": "no-cache"})


@app.get("/w/{rest:path}", include_in_schema=False)
def app_page(request: Request, rest: str):
    """A signed-in page, /w/<workspace id>/<page>: the same single page, kept out of search results."""
    response = index(request)
    response.headers["X-Robots-Tag"] = "noindex"
    return response


@app.get("/robots.txt", include_in_schema=False)
def robots(request: Request):
    return PlainTextResponse(
        f"User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /w/\n\nSitemap: {_origin(request)}/sitemap.xml\n"
    )


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap(request: Request):
    # The public pages: everything else is behind sign-in.
    return Response(seo.sitemap(_origin(request)), media_type="application/xml")


# The built frontend (npm run build). Mounted last so the API routes above win.
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
