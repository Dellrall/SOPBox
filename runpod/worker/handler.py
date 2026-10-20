"""RunPod serverless handler: order photo in, model reply text out.

Contract with the backend (src/backend/app/extraction.py):
  input   {"image": "<base64 JPEG of the delivery order>"}
  output  {"text": "<the model's reply>"}  or  {"error": "<why>"}
The backend parses and validates the text, so this worker only has to return what the model said.
"""

PROMPT = """You read photos of delivery orders for a food and beverage outlet.
Return only JSON in this exact shape, with one entry per order line:
{"lines": [{"name": "<item as written>", "quantity": <whole number>, "unit": "<unit as written, e.g. bdl, box, pcs>"}]}
If you cannot read a quantity, leave that line out. Do not guess. Write nothing outside the JSON."""


def run_model(image_b64: str) -> str:
    # TODO (Wed 21 Oct): load the chosen open-weight vision model once at import, run PROMPT with
    # the image, and return the raw reply. Until then no lines come back, so staff enter them by hand.
    return '{"lines": []}'


def handler(job: dict) -> dict:
    image_b64 = job.get("input", {}).get("image")
    if not isinstance(image_b64, str) or not image_b64:
        return {"error": "input.image (a base64 string) is required"}
    return {"text": run_model(image_b64)}


if __name__ == "__main__":
    import runpod

    runpod.serverless.start({"handler": handler})
