import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import catalogue, deliveries
from app.config import get_settings
from app.db import connect, get_db, init_db
from app.errors import (
    ConflictError,
    ExtractionError,
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
    Product,
    ProductIn,
)
from app.notifications import approval_needed_message, decision_message, send_telegram
from app.security import require_manager
from app.seed import seed_if_empty

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    conn = connect()
    try:
        seed_if_empty(conn)
    finally:
        conn.close()
    yield


app = FastAPI(title="SopBox Receiving Check API", lifespan=lifespan)

Conn = Annotated[sqlite3.Connection, Depends(get_db)]
Manager = Depends(require_manager)


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
]:
    app.add_exception_handler(_exc, _error_handler(_code))
# Duplicate names, a category that still has products, a product that is on a delivery.
app.add_exception_handler(
    sqlite3.IntegrityError,
    _error_handler(409, "conflicts with existing data (duplicate name, or the item is in use)"),
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ---- catalogue (reads are open; changes need the manager PIN) ---------------------------------


@app.get("/api/categories", response_model=list[Category])
def list_categories(conn: Conn):
    return catalogue.list_categories(conn)


@app.post("/api/categories", response_model=Category, status_code=201, dependencies=[Manager])
def create_category(body: CategoryIn, conn: Conn):
    return catalogue.create_category(conn, body)


@app.put("/api/categories/{category_id}", response_model=Category, dependencies=[Manager])
def update_category(category_id: int, body: CategoryIn, conn: Conn):
    return catalogue.update_category(conn, category_id, body)


@app.delete("/api/categories/{category_id}", status_code=204, dependencies=[Manager])
def delete_category(category_id: int, conn: Conn) -> None:
    catalogue.delete_category(conn, category_id)


@app.get("/api/products", response_model=list[Product])
def list_products(conn: Conn, q: str | None = Query(default=None, max_length=100)):
    """All products. `q` searches name, category and SOP text: this is the SOP lookup."""
    return catalogue.list_products(conn, q)


@app.get("/api/products/{product_id}", response_model=Product)
def get_product(product_id: int, conn: Conn):
    return catalogue.get_product(conn, product_id)


@app.post("/api/products", response_model=Product, status_code=201, dependencies=[Manager])
def create_product(body: ProductIn, conn: Conn):
    return catalogue.create_product(conn, body)


@app.put("/api/products/{product_id}", response_model=Product, dependencies=[Manager])
def update_product(product_id: int, body: ProductIn, conn: Conn):
    return catalogue.update_product(conn, product_id, body)


@app.delete("/api/products/{product_id}", status_code=204, dependencies=[Manager])
def delete_product(product_id: int, conn: Conn) -> None:
    catalogue.delete_product(conn, product_id)


# ---- receiving journey ------------------------------------------------------------------------


class ExtractRequest(BaseModel):
    # About 10 MB of image once base64 encoded. The frontend downsizes photos before sending.
    image_b64: str = Field(min_length=1, max_length=14_000_000)


@app.post("/api/extract", response_model=list[ExtractedLineOut])
def extract(body: ExtractRequest, conn: Conn):
    """Read an order photo. Staff must confirm every line before submitting the delivery."""
    products = catalogue.list_products(conn)
    return [
        ExtractedLineOut(**line.model_dump(), product_id=catalogue.match_product(line.name, products))
        for line in extract_lines(body.image_b64)
    ]


@app.post("/api/deliveries", response_model=Delivery, status_code=201)
def create_delivery(body: DeliveryIn, background: BackgroundTasks, conn: Conn):
    delivery = deliveries.create_delivery(conn, body)
    if delivery.status == "pending_approval":
        background.add_task(
            send_telegram,
            get_settings().telegram_manager_chat_id,
            approval_needed_message(delivery),
        )
    return delivery


@app.get("/api/deliveries", response_model=list[Delivery])
def list_deliveries(
    conn: Conn,
    status: DeliveryStatus | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    return deliveries.list_deliveries(conn, status, limit)


@app.get("/api/deliveries/{delivery_id}", response_model=Delivery)
def get_delivery(delivery_id: int, conn: Conn):
    return deliveries.get_delivery(conn, delivery_id)


@app.post(
    "/api/deliveries/{delivery_id}/decision", response_model=Delivery, dependencies=[Manager]
)
def decide(delivery_id: int, body: DecisionIn, background: BackgroundTasks, conn: Conn):
    delivery = deliveries.decide(conn, delivery_id, body)
    background.add_task(
        send_telegram, get_settings().telegram_staff_chat_id, decision_message(delivery)
    )
    return delivery


@app.get("/api/audit", response_model=list[AuditEntry])
def audit(conn: Conn, limit: int = Query(default=50, ge=1, le=200)):
    return deliveries.list_audit(conn, limit)


# The built frontend (npm run build). Mounted last so the API routes above win.
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
