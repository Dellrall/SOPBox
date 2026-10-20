"""Reading order photos: the model's reply is untrusted, so parsing and limits are tested hard."""

import httpx
import pytest

from app import extraction
from app.errors import ExtractionError, RateLimitError

LINE = {"name": "Fries tray", "quantity": 2, "unit": "bdl"}


# ---- parse_model_output -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "reply",
    [
        '{"lines": [{"name": "Fries tray", "quantity": 2, "unit": "bdl"}]}',
        '[{"name": "Fries tray", "quantity": 2, "unit": "bdl"}]',
        '```json\n{"lines": [{"name": "Fries tray", "quantity": 2, "unit": "bdl"}]}\n```',
        'Here is the order:\n{"lines": [{"name": "Fries tray", "quantity": 2, "unit": "bdl"}]}\nDone.',
        '{"lines": [{"name": "  Fries tray ", "quantity": "2", "unit": "bdl"}]}',
    ],
)
def test_parse_accepts_the_shapes_models_actually_produce(reply):
    (line,) = extraction.parse_model_output(reply)
    assert (line.name.strip(), line.quantity, line.unit) == ("Fries tray", 2, "bdl")


def test_parse_accepts_an_order_with_no_lines():
    assert extraction.parse_model_output('{"lines": []}') == []


@pytest.mark.parametrize(
    "reply",
    [
        "I could not read this photo.",
        "{not json at all}",
        '{"items": []}',
        '{"lines": "none"}',
        '{"lines": [{"name": "Fries tray", "quantity": 0, "unit": "bdl"}]}',
        '{"lines": [{"name": "Fries tray", "quantity": "two", "unit": "bdl"}]}',
        '{"lines": [{"name": "Fries tray", "quantity": 2.5, "unit": "bdl"}]}',
        '{"lines": [{"name": "Fries tray", "unit": "bdl"}]}',
        # One good line does not rescue a bad one: staff would not notice the missing line.
        '{"lines": [{"name": "A", "quantity": 1, "unit": "pcs"}, {"name": "B", "quantity": -1, "unit": "pcs"}]}',
    ],
)
def test_parse_rejects_anything_that_is_not_clean_lines(reply):
    with pytest.raises(ExtractionError):
        extraction.parse_model_output(reply)


# ---- extract_lines ----------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, body, status_code=200):
        self._body = body
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=None)

    def json(self):
        return self._body


@pytest.fixture
def runpod(monkeypatch):
    monkeypatch.setenv("EXTRACTION_MODE", "runpod")
    monkeypatch.setenv("RUNPOD_ENDPOINT_URL", "https://api.runpod.ai/v2/abc/runsync")
    monkeypatch.setenv("RUNPOD_API_KEY", "secret-key")


def completed(text):
    return FakeResponse({"status": "COMPLETED", "output": {"text": text}})


def test_mock_mode_returns_fixed_lines_without_using_the_budget(monkeypatch):
    monkeypatch.setattr(extraction, "EXTRACTION_MAX_PER_HOUR", 0)
    assert [line.name for line in extraction.extract_lines("img")] == ["Fries tray", "Frozen sausage"]


def test_runpod_mode_sends_the_image_with_the_key_and_parses_the_reply(runpod, monkeypatch):
    sent = {}

    def fake_post(url, headers, json, timeout):
        sent.update(url=url, headers=headers, json=json)
        return completed('{"lines": [{"name": "Fries tray", "quantity": 2, "unit": "bdl"}]}')

    monkeypatch.setattr(extraction.httpx, "post", fake_post)
    lines = extraction.extract_lines("aW1n")

    assert [(l.name, l.quantity, l.unit) for l in lines] == [("Fries tray", 2, "bdl")]
    assert sent["url"] == "https://api.runpod.ai/v2/abc/runsync"
    assert sent["headers"] == {"Authorization": "Bearer secret-key"}
    assert sent["json"] == {"input": {"image": "aW1n"}}


@pytest.mark.parametrize(
    "response",
    [
        FakeResponse({"status": "IN_QUEUE"}),
        FakeResponse({"status": "FAILED", "error": "CUDA out of memory"}),
        FakeResponse({"status": "COMPLETED", "output": {}}),
        FakeResponse({"status": "COMPLETED", "output": None}),
        completed("not json"),
    ],
)
def test_runpod_mode_turns_a_bad_job_into_an_extraction_error(runpod, monkeypatch, response):
    monkeypatch.setattr(extraction.httpx, "post", lambda *a, **k: response)
    with pytest.raises(ExtractionError):
        extraction.extract_lines("img")


def test_a_network_error_does_not_leak_the_api_key(runpod, monkeypatch):
    def fail(*args, **kwargs):
        raise httpx.ConnectError("could not connect with Bearer secret-key")

    monkeypatch.setattr(extraction.httpx, "post", fail)
    with pytest.raises(ExtractionError) as caught:
        extraction.extract_lines("img")
    assert "secret-key" not in str(caught.value)
    assert caught.value.__cause__ is None


def test_runpod_mode_needs_configuration(monkeypatch):
    monkeypatch.setenv("EXTRACTION_MODE", "runpod")
    with pytest.raises(ExtractionError, match="not configured"):
        extraction.extract_lines("img")


def test_an_unknown_mode_is_an_error(monkeypatch):
    monkeypatch.setenv("EXTRACTION_MODE", "gemini")
    with pytest.raises(ExtractionError, match="unknown EXTRACTION_MODE"):
        extraction.extract_lines("img")


def test_the_hourly_limit_stops_runaway_gpu_spend(runpod, monkeypatch):
    monkeypatch.setattr(extraction, "EXTRACTION_MAX_PER_HOUR", 2)
    calls = []
    monkeypatch.setattr(
        extraction.httpx, "post", lambda *a, **k: calls.append(1) or completed('{"lines": []}')
    )

    extraction.extract_lines("img")
    extraction.extract_lines("img")
    with pytest.raises(RateLimitError):
        extraction.extract_lines("img")
    assert len(calls) == 2  # the third call never reached RunPod


def test_the_hourly_limit_resets_after_an_hour(runpod, monkeypatch):
    monkeypatch.setattr(extraction, "EXTRACTION_MAX_PER_HOUR", 1)
    monkeypatch.setattr(extraction.httpx, "post", lambda *a, **k: completed('{"lines": []}'))
    clock = {"now": 1000.0}
    monkeypatch.setattr(extraction.time, "monotonic", lambda: clock["now"])

    extraction.extract_lines("img")
    clock["now"] += 3601
    extraction.extract_lines("img")  # does not raise


# ---- the route --------------------------------------------------------------------------------


def test_extract_route_returns_lines_in_mock_mode(client):
    resp = client.post("/api/extract", json={"image_b64": "ZmFrZQ=="})
    assert resp.status_code == 200
    assert [line["name"] for line in resp.json()] == ["Fries tray", "Frozen sausage"]
    assert all(line["product_id"] is None for line in resp.json())  # empty catalogue


def test_extract_route_rejects_an_empty_image(client):
    assert client.post("/api/extract", json={"image_b64": ""}).status_code == 422


def test_extract_route_maps_failures_to_502_and_429(client, monkeypatch):
    from app import main

    def fail(_):
        raise ExtractionError("could not reach the model endpoint")

    monkeypatch.setattr(main, "extract_lines", fail)
    resp = client.post("/api/extract", json={"image_b64": "ZmFrZQ=="})
    assert resp.status_code == 502
    assert resp.json()["detail"] == "could not reach the model endpoint"

    def limit(_):
        raise RateLimitError("paused")

    monkeypatch.setattr(main, "extract_lines", limit)
    assert client.post("/api/extract", json={"image_b64": "ZmFrZQ=="}).status_code == 429
