# RunPod

All model inference runs on RunPod. The app calls one serverless endpoint that runs RunPod's
official vLLM worker, so there is no custom image to build.

## Endpoint

| Setting | Value |
|---|---|
| Name / id | `sopbox-reader` / `sriet0cftztbik` |
| Image | `runpod/worker-v1-vllm:v2.28.0` (vLLM 0.30) |
| Model | `Qwen/Qwen3-VL-8B-Instruct-FP8` (8.8B parameters, 10.6 GB of weights, not gated) |
| Served model name | `sopbox-reader` (`OPENAI_SERVED_MODEL_NAME_OVERRIDE`) |
| Engine | `MAX_MODEL_LEN=8192`, `MAX_NUM_SEQS=4`, `GPU_MEMORY_UTILIZATION=0.90` |
| GPU pool | `AMPERE_24` (24 GB: RTX A5000, RTX 3090, L4, PRO 6000 MIG 24 GB). Serverless price $0.69 per hour on 23 Oct 2026 |
| Workers | min 0, max 1, idle timeout 30 s, FlashBoot on |
| CUDA floor | 13.0 |
| Container disk | 50 GB. Weights download on each cold start (no network volume) |

Sizing: 8.8B parameters at FP8 (1 byte each) is about 9 GB of weights plus the vision encoder,
which leaves room for the KV cache of 8192 tokens on a 24 GB card.

Cost: it bills only while a worker runs. A cold start (pull, download, load) took 2.5 minutes on an
RTX A5000 (job delay 148 s; the read itself took 1.8 s); after 30 s idle the worker stops. A warm worker
for the demo window costs $0.69 per hour (`workers.min = 1`). The demo is over; the endpoint is back
at `workers.min = 0`.

## Contract

The backend (`src/backend/app/extraction.py`) queues an OpenAI chat request, with the photo as a
`data:` URL, on `https://api.runpod.ai/v2/$RUNPOD_ENDPOINT_ID/run` (`openai_route` and
`openai_input`), then polls `/status/<job>` every second for up to 5 minutes. A job it gives up on is
cancelled. The queue is used instead of the synchronous `/openai/v1` route because a cold start
outlasts a synchronous request. The prompt asks for `{"lines": [{"name": "...", "quantity": 2, "unit": "bdl"}]}`. The backend strips
code fences and prose, then validates each line. One invalid line rejects the whole reply, and
staff enter the lines by hand.

Replit Secrets: `RUNPOD_ENDPOINT_ID=sriet0cftztbik` and `RUNPOD_API_KEY=<your key>` (RunPod
console, Settings, API Keys; a key with access to this endpoint).

Test it directly:

```bash
curl -s -X POST "https://api.runpod.ai/v2/sriet0cftztbik/openai/v1/chat/completions" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"sopbox-reader","messages":[{"role":"user","content":"Say ready"}],"max_tokens":5}'
```

## Swapping in fine-tuned weights

1. Fine-tune on a Pod (QLoRA on a 24 GB card is enough for the 8B model), merge the adapter and
   push the merged weights to a Hugging Face repo.
2. Change the endpoint's `MODEL_NAME` env to that repo (add `HF_TOKEN` if it is private).
3. Keep `OPENAI_SERVED_MODEL_NAME_OVERRIDE=sopbox-reader`, so the app needs no change.
4. Score both models with the same labelled orders before switching the demo to the new one.

## Spend guardrails

- The backend allows at most 60 model calls an hour (`EXTRACTION_MAX_PER_HOUR` in `extraction.py`). Beyond that, staff type the lines.
- Max 1 worker, so at most $0.69 per hour can bill from this endpoint.
- Check spend in the RunPod console under Billing; the team cap is USD 25.

## After-demo worker check

At the end of every demo, the operator checks the endpoint in the RunPod console:

1. Open the `sopbox-reader` endpoint (`sriet0cftztbik`) and inspect its worker settings.
2. Confirm **Minimum workers** is `0`. A nonzero minimum can keep a worker running and billing at up to $0.69 per hour.
3. If the value is nonzero, immediately alert the workspace owner in the configured workspace Telegram channel (Settings). If that channel is unavailable, contact the owner directly. Include the endpoint and observed value. For example:

   > RunPod post-demo alert: `sopbox-reader` (`sriet0cftztbik`) still has Minimum workers set to `1` after the demo. It may cost up to $0.69/hour. Please review the endpoint setting.
4. Do not change or save the endpoint setting as part of this check. The owner decides whether to change it.

Record the check and its result with the demo closeout. If the check was missed, perform it as soon as possible; repeat it each day until the post-demo setting has been reviewed.
