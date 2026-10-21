
from fastapi import FastAPI
from pydantic import BaseModel

from app.catalogue import CATALOGUE
from app.extraction import extract_lines
from app.models import (
    ExtractedLine,
    LineCheck,
    MapExtractedRequest,
    MappedExtractedLine,
    Product,
    ReceivedLine,
)
from app.product_mapping import map_extracted_line
from app.rules import check_delivery

app = FastAPI(title="Receiving Check API")


class ExtractRequest(BaseModel):
    image_b64: str


class CheckRequest(BaseModel):
    lines: list[ReceivedLine]


class CheckResponse(BaseModel):
    checks: list[LineCheck]
    needs_approval: bool


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/products", response_model=list[Product])
def products() -> list[Product]:
    return list(CATALOGUE.values())


@app.post("/api/extract", response_model=list[ExtractedLine])
async def extract(req: ExtractRequest) -> list[ExtractedLine]:
    return await extract_lines(req.image_b64)


@app.post("/api/deliveries/check", response_model=CheckResponse)
def check(req: CheckRequest) -> CheckResponse:
    checks = check_delivery(CATALOGUE, req.lines)
    return CheckResponse(
        checks=checks,
        needs_approval=any(not c.passed for c in checks),
    )


@app.post(
    "/api/products/map-extracted",
    response_model=list[MappedExtractedLine],
)
def map_extracted_products(
    req: MapExtractedRequest,
) -> list[MappedExtractedLine]:
    return [
        MappedExtractedLine(**map_extracted_line(line))
        for line in req.lines
    ]
