# src

- `backend/`: FastAPI app. `app/rules.py` holds the receiving rules, `app/deliveries.py` the journey and audit log, `app/extraction.py` the RunPod call and reply parser.
- `frontend/`: React + Vite + TypeScript + Tailwind. `src/types.ts` mirrors `backend/app/models.py`.

Run instructions, configuration and the API list are in the [root README](../README.md). Tests are in [`../tests`](../tests).
