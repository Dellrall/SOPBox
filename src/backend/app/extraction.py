"""Read an order photo into lines. The model runs on RunPod; this module only calls it.

Contract with runpod/worker/handler.py:
  request  {"input": {"image": "<base64 JPEG>"}}
  response {"status": "COMPLETED", "output": {"text": "<model reply>"}}
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
    if not (settings.runpod_endpoint_url and settings.runpod_api_key):
        raise ExtractionError("reading photos is not set up; enter the lines by hand")

    _take_budget()
    try:
        resp = httpx.post(
            settings.runpod_endpoint_url,
            headers={"Authorization": f"Bearer {settings.runpod_api_key}"},
            json={"input": {"image": image_b64}},
            timeout=120,
        )
        resp.raise_for_status()
        body = resp.json()
    except (httpx.HTTPError, ValueError) as err:
        logger.warning("runpod call failed: %s", type(err).__name__)
        raise ExtractionError("could not reach the model endpoint") from None

    if body.get("status") != "COMPLETED":
        raise ExtractionError(f"the model job did not finish (status {body.get('status')})")
    text = (body.get("output") or {}).get("text")
    if not isinstance(text, str):
        raise ExtractionError("model output is missing 'text'")
    return parse_model_output(text)
