"""Read an order photo into lines. The model runs on RunPod; this module only calls it.

The endpoint runs RunPod's vLLM worker, which serves an OpenAI-compatible chat API at
https://api.runpod.ai/v2/<endpoint-id>/openai/v1. See runpod/README.md for its settings.
The reply text is untrusted. It is parsed and validated here before anything else sees it.
"""

import json
import logging
import re
import threading
import time
from collections import deque

import httpx
from pydantic import ValidationError

from app.config import get_settings
from app.errors import ExtractionError, RateLimitError
from app.models import ExtractedLine

logger = logging.getLogger(__name__)

# Caps GPU spend if the public URL is hammered. At about USD 0.69 per GPU hour this is a ceiling,
# not a target. Staff can always type the lines by hand.
EXTRACTION_MAX_PER_HOUR = 60
_calls: deque[float] = deque()
_calls_lock = threading.Lock()

# The worker serves the model under this name (OPENAI_SERVED_MODEL_NAME_OVERRIDE), so swapping in
# fine-tuned weights only changes the endpoint, not the app.
MODEL = "sopbox-reader"
PROMPT = """You read photos of delivery orders for a food and beverage outlet.
Return only JSON in this exact shape, with one entry per order line:
{"lines": [{"name": "<item as written>", "quantity": <whole number>, "unit": "<unit as written, e.g. bdl, box, pcs>"}]}
If you cannot read a quantity, leave that line out. Do not guess. Write nothing outside the JSON."""
_ENDPOINT_ID = re.compile(r"^[a-z0-9]{6,32}$")

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def _take_budget() -> None:
    now = time.monotonic()
    with _calls_lock:
        while _calls and now - _calls[0] > 3600:
            _calls.popleft()
        if len(_calls) >= EXTRACTION_MAX_PER_HOUR:
            raise RateLimitError("reading photos is paused for this hour; enter the lines by hand")
        _calls.append(now)


def _load_json(text: str) -> object:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Models often wrap JSON in prose. Take the outermost object or array.
    starts = [i for i in (text.find("{"), text.find("[")) if i != -1]
    end = max(text.rfind("}"), text.rfind("]"))
    if not starts or end <= min(starts):
        raise ExtractionError("model output is not JSON")
    try:
        return json.loads(text[min(starts) : end + 1])
    except json.JSONDecodeError:
        raise ExtractionError("model output is not valid JSON") from None


def parse_model_output(text: str) -> list[ExtractedLine]:
    """Turn the model's reply into validated lines. One bad line rejects the whole reply."""
    candidate = text.strip()
    fenced = _FENCE.search(candidate)
    if fenced:
        candidate = fenced.group(1).strip()
    data = _load_json(candidate)
    rows = data.get("lines") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        raise ExtractionError("model output has no 'lines' list")
    try:
        return [ExtractedLine.model_validate(row) for row in rows]
    except ValidationError:
        raise ExtractionError("model returned a line that is not valid") from None


def extract_lines(image_b64: str) -> list[ExtractedLine]:
    settings = get_settings()
    if not (settings.runpod_endpoint_id and settings.runpod_api_key):
        raise ExtractionError("reading photos is not set up; enter the lines by hand")
    if not _ENDPOINT_ID.match(settings.runpod_endpoint_id):
        raise ExtractionError("RUNPOD_ENDPOINT_ID is not a valid endpoint id")

    _take_budget()
    try:
        resp = httpx.post(
            f"https://api.runpod.ai/v2/{settings.runpod_endpoint_id}/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.runpod_api_key}"},
            json={
                "model": MODEL,
                "temperature": 0,
                "max_tokens": 1024,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                            {"type": "text", "text": PROMPT},
                        ],
                    }
                ],
            },
            # A cold worker pulls the image and loads the model before it answers.
            timeout=180,
        )
        resp.raise_for_status()
        body = resp.json()
    except (httpx.HTTPError, ValueError) as err:
        logger.warning("runpod call failed: %s", type(err).__name__)
        raise ExtractionError("could not reach the model endpoint") from None

    try:
        text = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise ExtractionError("the model reply has no message") from None
    if not isinstance(text, str):
        raise ExtractionError("the model reply has no message")
    return parse_model_output(text)
