import html
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

import psycopg
from fastapi import BackgroundTasks, Depends, FastAPI, Query, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import accounts, auth, catalogue, deliveries, purchasing
from app.auth import CurrentUser, ManagerUp, OwnerOnly, User
from app.db import close_pool, get_db, init_db
from app.errors import (
    AuthError,
    ConflictError,
    ExtractionError,
    ForbiddenError,
    InvalidRequestError,
    NotFoundError,
    RateLimitError,
)
from app.extraction import extract_lines
from app.models import (
    ArchiveIn,
    CancelIn,
    LowStockDraftIn,
    PurchaseOrder,
    PurchaseOrderIn,
    Supplier,
    SupplierIn,
    AuditEntry,
    Category,
    CategoryIn,
    DecisionIn,
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
    RegisterIn,
    UserCreateIn,
    UserOut,
    UserUpdateIn,
    WorkspaceRef,
    WorkspaceSettings,
    WorkspaceUpdateIn,
)
from app.notifications import approval_needed_message, decision_message, send_telegram
from app.security import SECURITY_HEADERS

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield
    close_pool()


# Swagger UI loads its script from a CDN, which the strict CSP below would block.
app = FastAPI(title="SopBox API", lifespan=lifespan, docs_url=None, redoc_url=None)


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


def _error_handler(status_code: int, fixed_detail: str | None = None):
    async def handle(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse({"detail": fixed_detail or str(exc)}, status_code=status_code)

    return handle


for _exc, _code in [
    (NotFoundError, 404),
    (ConflictError, 409),
    (InvalidRequestError, 422),
    (ExtractionError, 502),
    (RateLimitError, 429),
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
}


async def _integrity_error(_: Request, exc: psycopg.IntegrityError) -> JSONResponse:
    detail = _CONFLICTS.get(exc.diag.constraint_name or "", "this conflicts with existing data")
    return JSONResponse({"detail": detail}, status_code=409)


app.add_exception_handler(psycopg.IntegrityError, _integrity_error)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ---- sign in, sign up -------------------------------------------------------------------------


def _me(user: CurrentUser) -> Me:
    return Me(
        id=user.id,
        username=user.username,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        workspace=WorkspaceRef(id=user.workspace_id, name=user.workspace_name),
    )


@app.post("/api/auth/register", response_model=Me, status_code=201)
def register(body: RegisterIn, request: Request, response: Response, conn: Conn):
    """Create a workspace. Whoever does this becomes its owner, with every permission."""
    auth.check_register_allowed(request.client.host if request.client else "unknown")
    user_id = accounts.register_workspace(conn, body)
    auth.start_session(conn, response, user_id)
    return _me(auth.get_me(conn, user_id))


@app.post("/api/auth/login", response_model=Me)
def login(body: LoginIn, response: Response, conn: Conn):
    user_id = accounts.authenticate(conn, body.username, body.password)
    auth.start_session(conn, response, user_id)
    return _me(auth.get_me(conn, user_id))


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, response: Response, conn: Conn) -> None:
    auth.end_session(conn, request, response)


@app.get("/api/auth/me", response_model=Me)
def me(user: User):
    return _me(user)


@app.get("/api/auth/session", response_model=Me | None)
def session(request: Request, conn: Conn):
    """Who is signed in, or null. Unlike /me, a signed-out visitor is not an error."""
    user = auth.optional_user(request, conn)
    return _me(user) if user else None


@app.patch("/api/auth/me", response_model=Me)
def update_me(body: ProfileUpdateIn, user: User, conn: Conn):
    accounts.update_profile(conn, user, body)
    return _me(auth.get_me(conn, user.id))


@app.post("/api/auth/password", status_code=204)
def change_password(body: PasswordChangeIn, request: Request, user: User, conn: Conn) -> None:
    accounts.change_own_password(
        conn, user, body.current_password, body.new_password, request.cookies.get(auth.COOKIE)
    )


# ---- owner: people and workspace settings -----------------------------------------------------


@app.get("/api/users", response_model=list[UserOut])
def list_users(owner: OwnerOnly, conn: Conn):
    return accounts.list_users(conn, owner)


@app.post("/api/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreateIn, owner: OwnerOnly, conn: Conn):
    return accounts.create_user(conn, owner, body)


@app.patch("/api/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdateIn, owner: OwnerOnly, conn: Conn):
    return accounts.update_user(conn, owner, user_id, body)


@app.get("/api/workspace", response_model=WorkspaceSettings)
def get_workspace(owner: OwnerOnly, conn: Conn):
    return accounts.get_workspace(conn, owner.workspace_id)


@app.patch("/api/workspace", response_model=WorkspaceSettings)
def update_workspace(body: WorkspaceUpdateIn, owner: OwnerOnly, conn: Conn):
    return accounts.update_workspace(conn, owner, body)


# ---- catalogue (anyone signed in can read; owners and managers change it) ---------------------


@app.get("/api/categories", response_model=list[Category])
def list_categories(user: User, conn: Conn):
    return catalogue.list_categories(conn, user.workspace_id)


@app.post("/api/categories", response_model=Category, status_code=201)
def create_category(body: CategoryIn, user: ManagerUp, conn: Conn):
    return catalogue.create_category(conn, user.workspace_id, body)


@app.put("/api/categories/{category_id}", response_model=Category)
def update_category(category_id: int, body: CategoryIn, user: ManagerUp, conn: Conn):
    return catalogue.update_category(conn, user.workspace_id, category_id, body)


@app.delete("/api/categories/{category_id}", status_code=204)
def delete_category(category_id: int, user: ManagerUp, conn: Conn) -> None:
    catalogue.delete_category(conn, user.workspace_id, category_id)


@app.get("/api/products", response_model=list[Product])
def list_products(user: User, conn: Conn, q: str | None = Query(default=None, max_length=100)):
    """All products. `q` searches name, category and SOP text: this is the SOP lookup."""
    return catalogue.list_products(conn, user.workspace_id, q)


@app.get("/api/products/{product_id}", response_model=Product)
def get_product(product_id: int, user: User, conn: Conn):
    return catalogue.get_product(conn, user.workspace_id, product_id)


@app.post("/api/products", response_model=Product, status_code=201)
def create_product(body: ProductIn, user: ManagerUp, conn: Conn):
    return catalogue.create_product(conn, user.workspace_id, body)


@app.put("/api/products/{product_id}", response_model=Product)
def update_product(product_id: int, body: ProductIn, user: ManagerUp, conn: Conn):
    return catalogue.update_product(conn, user.workspace_id, product_id, body)


@app.patch("/api/products/{product_id}", response_model=Product)
def archive_product(product_id: int, body: ArchiveIn, user: ManagerUp, conn: Conn):
    """Archive (or restore) a product: it leaves receiving but keeps its delivery history."""
    return catalogue.set_archived(conn, user.workspace_id, product_id, body.archived)


@app.delete("/api/products/{product_id}", status_code=204)
def delete_product(product_id: int, user: ManagerUp, conn: Conn) -> None:
    catalogue.delete_product(conn, user.workspace_id, product_id)


# ---- purchasing: suppliers and purchase orders ------------------------------------------------
# Anyone signed in can read them (staff receive against issued orders); managers write.


@app.get("/api/suppliers", response_model=list[Supplier])
def list_suppliers(user: User, conn: Conn):
    return purchasing.list_suppliers(conn, user.workspace_id)


@app.post("/api/suppliers", response_model=Supplier, status_code=201)
def create_supplier(body: SupplierIn, user: ManagerUp, conn: Conn):
    return purchasing.create_supplier(conn, user.workspace_id, body)


@app.put("/api/suppliers/{supplier_id}", response_model=Supplier)
def update_supplier(supplier_id: int, body: SupplierIn, user: ManagerUp, conn: Conn):
    return purchasing.update_supplier(conn, user.workspace_id, supplier_id, body)


@app.patch("/api/suppliers/{supplier_id}", response_model=Supplier)
def archive_supplier(supplier_id: int, body: ArchiveIn, user: ManagerUp, conn: Conn):
    return purchasing.set_supplier_archived(conn, user.workspace_id, supplier_id, body.archived)


@app.get("/api/purchase-orders", response_model=list[PurchaseOrder])
def list_purchase_orders(
    user: User, conn: Conn, status: Literal["draft", "issued", "cancelled"] | None = None
):
    return purchasing.list_orders(conn, user.workspace_id, status)


@app.get("/api/purchase-orders/{order_id}", response_model=PurchaseOrder)
def get_purchase_order(order_id: int, user: User, conn: Conn):
    return purchasing.get_order(conn, user.workspace_id, order_id)


@app.post("/api/purchase-orders", response_model=PurchaseOrder, status_code=201)
def create_purchase_order(body: PurchaseOrderIn, user: ManagerUp, conn: Conn):
    return purchasing.create_order(conn, user.workspace_id, user.display_name, body)


@app.post("/api/purchase-orders/low-stock-draft", response_model=PurchaseOrder, status_code=201)
def draft_from_low_stock(body: LowStockDraftIn, user: ManagerUp, conn: Conn):
    return purchasing.low_stock_draft(conn, user.workspace_id, user.display_name, body)


@app.put("/api/purchase-orders/{order_id}", response_model=PurchaseOrder)
def update_purchase_order(order_id: int, body: PurchaseOrderIn, user: ManagerUp, conn: Conn):
    return purchasing.update_order(conn, user.workspace_id, user.display_name, order_id, body)


@app.post("/api/purchase-orders/{order_id}/issue", response_model=PurchaseOrder)
def issue_purchase_order(order_id: int, user: ManagerUp, conn: Conn):
    return purchasing.issue_order(conn, user.workspace_id, user.display_name, order_id)


@app.post("/api/purchase-orders/{order_id}/cancel", response_model=PurchaseOrder)
def cancel_purchase_order(order_id: int, body: CancelIn, user: ManagerUp, conn: Conn):
    return purchasing.cancel_order(conn, user.workspace_id, user.display_name, order_id, body.reason)


# ---- receiving journey ------------------------------------------------------------------------


class ExtractRequest(BaseModel):
    # About 10 MB of image once base64 encoded. The frontend downsizes photos before sending.
    image_b64: str = Field(min_length=1, max_length=14_000_000)


@app.post("/api/extract", response_model=list[ExtractedLineOut])
def extract(body: ExtractRequest, user: User, conn: Conn):
    """Read an order photo. Staff must confirm every line before submitting the delivery."""
    products = catalogue.list_products(conn, user.workspace_id, active_only=True)
    return [
        ExtractedLineOut(**line.model_dump(), product_id=catalogue.match_product(line.name, products))
        for line in extract_lines(body.image_b64)
    ]


@app.post("/api/deliveries", response_model=Delivery, status_code=201)
def create_delivery(body: DeliveryIn, background: BackgroundTasks, user: User, conn: Conn):
    delivery = deliveries.create_delivery(conn, user.workspace_id, user.display_name, body)
    if delivery.status == "pending_approval":
        chat = accounts.get_workspace(conn, user.workspace_id).telegram_manager_chat_id
        background.add_task(send_telegram, chat, approval_needed_message(delivery))
    return delivery


@app.get("/api/deliveries", response_model=list[Delivery])
def list_deliveries(
    user: User,
    conn: Conn,
    status: DeliveryStatus | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    return deliveries.list_deliveries(conn, user.workspace_id, status, limit)


@app.get("/api/deliveries/{delivery_id}", response_model=Delivery)
def get_delivery(delivery_id: int, user: User, conn: Conn):
    return deliveries.get_delivery(conn, user.workspace_id, delivery_id)


@app.post("/api/deliveries/{delivery_id}/decision", response_model=Delivery)
def decide(
    delivery_id: int, body: DecisionIn, background: BackgroundTasks, user: ManagerUp, conn: Conn
):
    delivery = deliveries.decide(conn, user.workspace_id, delivery_id, user.display_name, body)
    chat = accounts.get_workspace(conn, user.workspace_id).telegram_staff_chat_id
    background.add_task(send_telegram, chat, decision_message(delivery))
    return delivery


@app.get("/api/audit", response_model=list[AuditEntry])
def audit(user: ManagerUp, conn: Conn, limit: int = Query(default=50, ge=1, le=200)):
    return deliveries.list_audit(conn, user.workspace_id, limit)


# ---- pages for browsers and search engines ---------------------------------------------------


def _origin(request: Request) -> str:
    """This site's address, e.g. https://sopbox.replit.app. uvicorn runs with --proxy-headers, so
    behind Replit's proxy this is the public https address."""
    return str(request.base_url).rstrip("/")


@app.get("/", include_in_schema=False)
@app.get("/index.html", include_in_schema=False)
@app.get("/signin", include_in_schema=False)
@app.get("/register", include_in_schema=False)
def index(request: Request):
    """The app's single page, with absolute URLs filled in for link previews and the canonical link."""
    page = FRONTEND_DIST / "index.html"
    if not page.is_file():
        return PlainTextResponse("Frontend not built. Run npm run build in src/frontend.", status_code=503)
    body = page.read_text(encoding="utf-8").replace("__ORIGIN__", html.escape(_origin(request)))
    # Always fetch the page fresh, so a new deploy's script and style names are picked up.
    return HTMLResponse(body, headers={"Cache-Control": "no-cache"})


@app.get("/robots.txt", include_in_schema=False)
def robots(request: Request):
    return PlainTextResponse(
        f"User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: {_origin(request)}/sitemap.xml\n"
    )


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap(request: Request):
    # One public page: everything else is behind sign-in.
    url = html.escape(_origin(request))
    return Response(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"<url><loc>{url}/</loc></url></urlset>\n",
        media_type="application/xml",
    )


# The built frontend (npm run build). Mounted last so the API routes above win.
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
