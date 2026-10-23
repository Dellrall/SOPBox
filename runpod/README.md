# RunPod

All model inference runs on RunPod. This folder holds the serverless worker.

```
worker/handler.py        Handler. Stub until the model is chosen (Wed 21 Oct)
worker/Dockerfile        Image for the endpoint
worker/requirements.txt
```

## Contract

The backend (`src/backend/app/extraction.py`) calls the endpoint's `runsync` URL.

```
request   {"input": {"image": "<base64 JPEG of the delivery order>"}}
response  {"status": "COMPLETED", "output": {"text": "<the model's reply>"}}
```

The reply should be `{"lines": [{"name": "...", "quantity": 2, "unit": "bdl"}]}`. `PROMPT` in `handler.py` asks for exactly that. The backend strips code fences and surrounding prose, then validates each line. One invalid line rejects the whole reply, and staff enter the lines by hand.

A handler that returns `{"error": "..."}` makes the job fail, which the app shows as "could not read the order".

## Endpoint settings

From the proposal's budget (USD 25 cap):

| Setting | Value |
|---|---|
| Type | Serverless, queue based |
| GPU group | 24 GB: "L4, A5000, 3090". Serverless price in the Runpod catalogue on 20 Oct 2026 was $0.69 per hour |
| Workers | min 0, max 1 |
| Idle timeout | 5 to 10 seconds |
| CUDA floor | 12.8 |
| Storage | One network volume for model weights, so cold starts do not re-download. Check its billing first |

A warm worker costs about $16.56 a day at $0.69 per hour. Keep minimum workers at 0 except for the demo window.

## Build and deploy

1. Pick the model on Wed 21 Oct, then fill in `run_model()` in `worker/handler.py`.
2. Swap the Dockerfile base for a CUDA or PyTorch image that suits the model.
3. Build and push: `docker build -t <registry>/sopbox-worker:0.1 runpod/worker && docker push <registry>/sopbox-worker:0.1`
4. Create the serverless endpoint from that image with the settings above.
5. Put the endpoint's `runsync` URL and your API key in Replit Secrets as `RUNPOD_ENDPOINT_URL` and `RUNPOD_API_KEY`, and set `EXTRACTION_MODE=runpod`.

Test an endpoint directly:

```bash
curl -s -X POST "https://api.runpod.ai/v2/<endpoint-id>/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {"image": "<base64>"}}'
```

The first request after idle is a cold start and can take minutes.

## Spend guardrails

- The backend allows at most 60 model calls an hour (`EXTRACTION_MAX_PER_HOUR` in `extraction.py`). Beyond that, staff type the lines.
- The frontend shrinks photos to 1600 px before sending.
- Everything except the real extraction path runs against the mock, so development costs nothing.
- Stop or delete test endpoints when a session ends, and check the balance after each one.
