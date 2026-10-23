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
        # One good line does not rescue a bad one: staff would not notice the missing line.
        '{"lines": [{"name": "A", "quantity": 1, "unit": "pcs"}, {"name": "B", "quantity": -1, "unit": "pcs"}]}',
    ],
)
def test_parse_rejects_anything_that_is_not_clean_lines(reply):
    with pytest.raises(ExtractionError):
        extraction.parse_model_output(reply)


def test_parses_the_reply_qwen3_vl_gave_for_the_sample_order():
    # Recorded from endpoint sriet0cftztbik on 23 Oct 2026 for a synthetic 4-line delivery order.
    reply = (
        '{"lines": [{"name": "Frozen Sausage 1kg", "quantity": 10, "unit": "pkt"}, '
        '{"name": "Chocolate Balls", "quantity": 2, "unit": "box"}, '
        '{"name": "Fries Tray", "quantity": 2, "unit": "bdl"}, '
        '{"name": "Coke 330ml", "quantity": 3, "unit": "ctn"}]}'
    )
    lines = extraction.parse_model_output(reply)
    assert [(l.name, l.quantity, l.unit) for l in lines] == [
        ("Frozen Sausage 1kg", 10, "pkt"),
        ("Chocolate Balls", 2, "box"),
        ("Fries Tray", 2, "bdl"),
        ("Coke 330ml", 3, "ctn"),
    ]


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
    monkeypatch.setenv("RUNPOD_ENDPOINT_ID", "abc123xyz")
    monkeypatch.setenv("RUNPOD_API_KEY", "secret-key")


def completed(text):
    # What /status returns for a finished job; the worker wraps the OpenAI reply in a list.
    return {"status": "COMPLETED", "output": [{"choices": [{"message": {"role": "assistant", "content": text}}]}]}


class FakeRunPod:
    """Stands in for httpx against the endpoint: /run queues, /status replays `statuses`."""

    def __init__(self, monkeypatch, *statuses):
        self.statuses = list(statuses)
        self.posts = []
        self.gets = []
        monkeypatch.setattr(extraction.httpx, "post", self.post)
        monkeypatch.setattr(extraction.httpx, "get", self.get)

    def post(self, url, headers, json=None, timeout=None):
        self.posts.append({"url": url, "headers": headers, "json": json})
        return FakeResponse({"id": "job-1", "status": "IN_QUEUE"})

    def get(self, url, headers, timeout=None):
        self.gets.append(url)
        body = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
        return FakeResponse(body)

    @property
    def cancelled(self):
        return [p["url"] for p in self.posts if "/cancel/" in p["url"]]


def no_sleep(_seconds):
    pass


def test_an_unread_quantity_or_unit_stays_as_a_line_with_a_warning():
    reply = (
        '{"lines": [{"name": "Fries tray", "quantity": null, "unit": "bdl", "warning": "quantity crossed out"},'
        ' {"name": "Coke", "quantity": 3, "unit": "", "warning": ""}]}'
    )
    fries, coke = extraction.parse_model_output(reply)
    assert (fries.quantity, fries.unit, fries.warning) == (None, "bdl", "quantity crossed out")
    assert (coke.quantity, coke.unit, coke.warning) == (3, None, None)


def test_a_zero_quantity_is_still_rejected():
    with pytest.raises(ExtractionError):
        extraction.parse_model_output('{"lines": [{"name": "Coke", "quantity": 0, "unit": "ctn"}]}')


def test_a_reply_cut_off_by_the_token_limit_is_refused(runpod, monkeypatch):
    cut = {"status": "COMPLETED", "output": [{"choices": [{"finish_reason": "length", "message": {"content": '{"lines": []}'}}]}]}
    FakeRunPod(monkeypatch, cut)
    with pytest.raises(ExtractionError, match="cut off"):
        extraction.extract_lines("img", sleep=no_sleep)


def test_runpod_mode_queues_the_image_waits_and_parses_the_reply(runpod, monkeypatch):
    fake = FakeRunPod(
        monkeypatch,
        {"status": "IN_QUEUE"},
        {"status": "IN_PROGRESS"},
        completed('{"lines": [{"name": "Fries tray", "quantity": 2, "unit": "bdl"}]}'),
    )
    lines = extraction.extract_lines("aW1n", sleep=no_sleep)

    assert [(l.name, l.quantity, l.unit) for l in lines] == [("Fries tray", 2, "bdl")]
    run = fake.posts[0]
    assert run["url"] == "https://api.runpod.ai/v2/abc123xyz/run"
    assert run["headers"] == {"Authorization": "Bearer secret-key"}
    assert run["json"]["input"]["openai_route"] == "/v1/chat/completions"
    request = run["json"]["input"]["openai_input"]
    assert request["model"] == extraction.MODEL
    # The document is data: the instruction not to obey it comes first, as a system message.
    assert request["messages"][0] == {"role": "system", "content": extraction.SYSTEM}
    content = request["messages"][1]["content"]
    assert content[0] == {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,aW1n"}}
    assert content[1] == {"type": "text", "text": extraction.PROMPT}
    assert fake.gets == ["https://api.runpod.ai/v2/abc123xyz/status/job-1"] * 3
    assert fake.cancelled == []


def test_an_endpoint_id_that_is_not_an_id_is_refused(runpod, monkeypatch):
    monkeypatch.setenv("RUNPOD_ENDPOINT_ID", "evil.example/x")
    monkeypatch.setattr(extraction.httpx, "post", lambda *a, **k: pytest.fail("must not call out"))
    with pytest.raises(ExtractionError):
        extraction.extract_lines("img")


@pytest.mark.parametrize(
    "status",
    [
        {"status": "FAILED", "error": "CUDA out of memory"},
        {"status": "COMPLETED", "output": [{"choices": []}]},
        {"status": "COMPLETED", "output": None},
        {"status": "COMPLETED", "output": [{"choices": [{"message": {"content": None}}]}]},
        completed("not json"),
    ],
)
def test_runpod_mode_turns_a_bad_job_into_an_extraction_error(runpod, monkeypatch, status):
    FakeRunPod(monkeypatch, status)
    with pytest.raises(ExtractionError):
        extraction.extract_lines("img", sleep=no_sleep)


def test_a_job_that_outlasts_the_wait_is_cancelled(runpod, monkeypatch):
    fake = FakeRunPod(monkeypatch, {"status": "IN_QUEUE"})
    clock = {"now": 0.0}
    monkeypatch.setattr(extraction.time, "monotonic", lambda: clock["now"])

    def sleep(seconds):
        clock["now"] += 60

    with pytest.raises(ExtractionError, match="still starting"):
        extraction.extract_lines("img", sleep=sleep)
    assert fake.cancelled == ["https://api.runpod.ai/v2/abc123xyz/cancel/job-1"]


def test_a_rejected_job_id_is_not_used_in_a_url(runpod, monkeypatch):
    monkeypatch.setattr(extraction.httpx, "post", lambda *a, **k: FakeResponse({"id": "../../x"}))
    monkeypatch.setattr(extraction.httpx, "get", lambda *a, **k: pytest.fail("must not poll"))
    with pytest.raises(ExtractionError):
        extraction.extract_lines("img", sleep=no_sleep)


def test_a_network_error_does_not_leak_the_api_key(runpod, monkeypatch):
    def fail(*args, **kwargs):
        raise httpx.ConnectError("could not connect with Bearer secret-key")

    monkeypatch.setattr(extraction.httpx, "post", fail)
    with pytest.raises(ExtractionError) as caught:
        extraction.extract_lines("img")
    assert "secret-key" not in str(caught.value)
    assert caught.value.__cause__ is None


def test_reading_photos_needs_a_configured_endpoint():
    with pytest.raises(ExtractionError, match="not set up"):
        extraction.extract_lines("img")


def test_the_route_says_so_when_reading_photos_is_not_set_up(client):
    resp = client.post("/api/extract", json={"image_b64": "ZmFrZQ=="})
    assert resp.status_code == 502
    assert "enter the lines by hand" in resp.json()["detail"]


def test_the_hourly_limit_stops_runaway_gpu_spend(runpod, monkeypatch):
    monkeypatch.setattr(extraction, "EXTRACTION_MAX_PER_HOUR", 2)
    fake = FakeRunPod(monkeypatch, completed('{"lines": []}'))

    extraction.extract_lines("img", sleep=no_sleep)
    extraction.extract_lines("img", sleep=no_sleep)
    with pytest.raises(RateLimitError):
        extraction.extract_lines("img", sleep=no_sleep)
    assert len(fake.posts) == 2  # the third call never reached RunPod


def test_the_hourly_limit_resets_after_an_hour(runpod, monkeypatch):
    monkeypatch.setattr(extraction, "EXTRACTION_MAX_PER_HOUR", 1)
    FakeRunPod(monkeypatch, completed('{"lines": []}'))
    clock = {"now": 1000.0}
    monkeypatch.setattr(extraction.time, "monotonic", lambda: clock["now"])

    extraction.extract_lines("img", sleep=no_sleep)
    clock["now"] += 3601
    extraction.extract_lines("img", sleep=no_sleep)  # does not raise


# ---- the route --------------------------------------------------------------------------------


def test_extract_route_returns_lines_matched_to_the_catalogue(client, catalogue_ids, monkeypatch):
    from app import main
    from app.models import ExtractedLine

    monkeypatch.setattr(
        main,
        "extract_lines",
        lambda _: [
            ExtractedLine(name="Fries tray", quantity=2, unit="bdl"),
            ExtractedLine(name="Mystery sauce", quantity=1, unit="box"),
        ],
    )
    resp = client.post("/api/extract", json={"image_b64": "ZmFrZQ=="})
    assert resp.status_code == 200
    assert [line["product_id"] for line in resp.json()] == [catalogue_ids["fries"], None]


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


def test_parses_the_reply_for_a_scribbled_out_quantity():
    # Recorded from endpoint sriet0cftztbik on 24 Oct 2026 with the current PROMPT, for an order
    # whose Fries Tray quantity was scribbled over. The model left it blank and said why.
    reply = (
        '{\n  "lines": [\n    {"name": "Frozen Sausage 1kg", "quantity": 10, "unit": "pkt"},\n'
        '    {"name": "Fries Tray", "quantity": null, "unit": "bdl", "warning": "quantity unclear"},\n'
        '    {"name": "Coke 330ml", "quantity": 3, "unit": "ctn"}\n  ]\n}'
    )
    sausage, fries, coke = extraction.parse_model_output(reply)
    assert (sausage.quantity, coke.quantity) == (10, 3)
    assert (fries.quantity, fries.warning) == (None, "quantity unclear")
