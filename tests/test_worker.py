"""The RunPod worker and the backend must agree on the contract, whatever model sits behind it."""

import handler
from app.extraction import parse_model_output


def test_the_worker_reply_is_text_the_backend_can_parse():
    reply = handler.handler({"input": {"image": "aW1n"}})
    assert set(reply) == {"text"}
    assert isinstance(parse_model_output(reply["text"]), list)


def test_the_worker_refuses_a_job_with_no_image():
    for job in ({"input": {}}, {"input": {"image": ""}}, {"input": {"image": 5}}):
        assert "error" in handler.handler(job)


def test_importing_the_worker_does_not_start_the_runpod_loop():
    # `import handler` above would hang or fail if the module started the serverless runner.
    assert callable(handler.handler)
