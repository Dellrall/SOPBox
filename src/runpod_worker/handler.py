import runpod


def handler(job: dict) -> dict:
    image_b64 = job["input"]["image"]  # noqa: F841 - used once the model is wired in
    # TODO: load the chosen open-weight vision model (decided Wed 21 Oct) and parse the
    # order photo into lines. Until then this returns no lines, so staff enter them manually.
    return {"lines": []}


runpod.serverless.start({"handler": handler})
