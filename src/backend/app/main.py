from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import psycopg
from fastapi import BackgroundTasks, Depends, FastAPI, Query, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import accounts, auth, catalogue, deliveries
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
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.update(SECURITY_HEADERS)
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
# Duplicate names, a category that still has products, a product that is on a delivery.
app.add_exception_handler(
    psycopg.IntegrityError,
    _error_handler(409, "conflicts with existing data (duplicate name, or the item is in use)"),
)


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


@app.delete("/api/products/{product_id}", status_code=204)
def delete_product(product_id: int, user: ManagerUp, conn: Conn) -> None:
    catalogue.delete_product(conn, user.workspace_id, product_id)


# ---- receiving journey ------------------------------------------------------------------------


class ExtractRequest(BaseModel):
    # About 10 MB of image once base64 encoded. The frontend downsizes photos before sending.
    image_b64: str = Field(min_length=1, max_length=14_000_000)


@app.post("/api/extract", response_model=list[ExtractedLineOut])
def extract(body: ExtractRequest, user: User, conn: Conn):
    """Read an order photo. Staff must confirm every line before submitting the delivery."""
    products = catalogue.list_products(conn, user.workspace_id)
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


# The built frontend (npm run build). Mounted last so the API routes above win.
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
