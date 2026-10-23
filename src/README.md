# src

- `backend/`: FastAPI app. `app/auth.py` and `app/accounts.py` hold sign-in, workspaces and roles, `app/rules.py` the receiving rules, `app/deliveries.py` the journey and audit log, `app/extraction.py` the RunPod call and reply parser, `app/db.py` the PostgreSQL schema and Row Level Security.
- `frontend/`: React + Vite + TypeScript + Tailwind, in the SOPBox green Orbyte-style shell. `src/types.ts` mirrors `backend/app/models.py`.

Run instructions, Replit deployment, configuration and the API list are in the [root README](../README.md). Tests are in [`../tests`](../tests).
