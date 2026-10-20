import httpx

from app.config import settings
from app.models import ExtractedLine

MOCK_LINES = [
    ExtractedLine(name="Fries tray", quantity=2, unit="bdl"),
    ExtractedLine(name="Frozen sausage", quantity=40, unit="pcs"),
]


async def extract_lines(image_b64: str) -> list[ExtractedLine]:
    if settings.extraction_mode == "mock":
        return MOCK_LINES
    if settings.extraction_mode != "runpod":
        raise ValueError(f"unknown EXTRACTION_MODE: {settings.extraction_mode}")

    # RunPod serverless runsync: POST {"input": {...}}, reply has "status" and "output".
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            settings.runpod_endpoint_url,
            headers={"Authorization": f"Bearer {settings.runpod_api_key}"},
            json={"input": {"image": image_b64}},
        )
    resp.raise_for_status()
    body = resp.json()
    if body.get("status") != "COMPLETED":
        raise RuntimeError(f"RunPod job did not complete: {body.get('status')}")
    return [ExtractedLine(**line) for line in body["output"]["lines"]]
