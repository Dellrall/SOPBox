# src

Source for the receiving check. Three parts:

- `backend/`: FastAPI API with the rules engine, the seed catalogue, and the extraction client.
- `frontend/`: React + Vite + TypeScript app. It proxies `/api` to the backend.
- `runpod_worker/`: RunPod serverless handler for the vision model. Currently a stub.

## Run it locally

Backend (terminal 1):

```bash
cd src/backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m pytest
uvicorn app.main:app --reload --port 8000
```

Frontend (terminal 2):

```bash
cd src/frontend
npm install
npm run dev     # http://localhost:5173
```

Open http://localhost:5173. The product list comes from `GET /api/products`.

## Modes

- `EXTRACTION_MODE=mock` (default): `POST /api/extract` returns fixed lines, so the flow works without a GPU.
- `EXTRACTION_MODE=runpod`: calls `RUNPOD_ENDPOINT_URL` with `RUNPOD_API_KEY`. Set both in your shell first. See `backend/.env.example`.

## Not built yet

- The RunPod model in `runpod_worker/handler.py` returns no lines. Wire in the chosen model on Wednesday.
- The ADK extraction agent. The client calls RunPod directly for now and will be wrapped in ADK.
- The catalogue has 5 seed products. Add the rest, and the Coke pack unit once the team agrees on it.
- Persistence (PostgreSQL), manager approval, the audit log, stock updates, and Telegram notifications.
- The frontend only lists products. The photo, line confirmation, and check screens come next.
