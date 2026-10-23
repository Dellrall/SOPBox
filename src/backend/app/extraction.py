"""Read an order photo into lines. The model runs on RunPod; this module only calls it.

The endpoint runs RunPod's vLLM worker. The photo goes in as an OpenAI chat request through the
endpoint's job queue (/run, then /status), because a cold worker can take minutes to load the model
and a synchronous call would time out first. See runpod/README.md for the endpoint settings.
The reply text is untrusted. It is parsed and validated here before anything else sees it.
"""

import json
import logging
import re
import threading
import time
from collections.abc import Callable
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
_JOB_ID = re.compile(r"^[A-Za-z0-9-]{1,80}$")
# Cold start (image, weights, load) took about 2.5 minutes on an RTX A5000 on 23 Oct 2026.
WAIT_SECONDS = 300
POLL_SECONDS = 2.0
_TERMINAL = {"COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"}

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


def _reply_text(output: object) -> str:
    # The worker returns the OpenAI response, sometimes wrapped in a one-item list.
    if isinstance(output, list) and output:
        output = output[0]
    try:
        text = output["choices"][0]["message"]["content"]  # type: ignore[index]
    except (KeyError, IndexError, TypeError):
        raise ExtractionError("the model reply has no message") from None
    if not isinstance(text, str):
        raise ExtractionError("the model reply has no message")
    return text


def extract_lines(image_b64: str, sleep: Callable[[float], None] = time.sleep) -> list[ExtractedLine]:
    settings = get_settings()
    if not (settings.runpod_endpoint_id and settings.runpod_api_key):
        raise ExtractionError("reading photos is not set up; enter the lines by hand")
    if not _ENDPOINT_ID.match(settings.runpod_endpoint_id):
        raise ExtractionError("RUNPOD_ENDPOINT_ID is not a valid endpoint id")

    _take_budget()
    base = f"https://api.runpod.ai/v2/{settings.runpod_endpoint_id}"
    headers = {"Authorization": f"Bearer {settings.runpod_api_key}"}
    request = {
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
    }
    job_id = None
    try:
        resp = httpx.post(
            f"{base}/run",
            headers=headers,
            json={"input": {"openai_route": "/v1/chat/completions", "openai_input": request}},
            timeout=30,
        )
        resp.raise_for_status()
        job_id = resp.json().get("id")
        if not isinstance(job_id, str) or not _JOB_ID.match(job_id):
            raise ExtractionError("the model endpoint did not accept the job")

        deadline = time.monotonic() + WAIT_SECONDS
        while True:
            resp = httpx.get(f"{base}/status/{job_id}", headers=headers, timeout=30)
            resp.raise_for_status()
            body = resp.json()
            if body.get("status") in _TERMINAL:
                break
            if time.monotonic() >= deadline:
                break
            sleep(POLL_SECONDS)
    except (httpx.HTTPError, ValueError, AttributeError) as err:
        logger.warning("runpod call failed: %s", type(err).__name__)
        _cancel(base, headers, job_id)
        raise ExtractionError("could not reach the model endpoint") from None

    status = body.get("status")
    if status != "COMPLETED":
        _cancel(base, headers, job_id)
        if status in _TERMINAL:
            raise ExtractionError(f"the model job did not finish (status {status})")
        raise ExtractionError("the model is still starting; try again in a minute or enter the lines by hand")
    return parse_model_output(_reply_text(body.get("output")))


def _cancel(base: str, headers: dict[str, str], job_id: str | None) -> None:
    """Stop a job we gave up on, so it does not run (and bill) after staff moved on."""
    if not job_id:
        return
    try:
        httpx.post(f"{base}/cancel/{job_id}", headers=headers, timeout=10)
    except httpx.HTTPError:
        logger.warning("could not cancel runpod job")
