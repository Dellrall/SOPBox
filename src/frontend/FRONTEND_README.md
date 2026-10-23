# SopBox Frontend — Orbyte-inspired integrated module

## Quick start

```bash
cd src/frontend
npm install
npm run dev
```

Start the existing FastAPI server in a second terminal:

```bash
cd src/backend
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The Vite dev server proxies `/api` to `http://localhost:8000`.

## Implemented

- Orbyte-inspired navigation, organization selector, responsive dashboard, delivery list, status badges and details modal.
- Employee/Admin role *simulation* (not real authentication or authorization).
- Guided receiving check: supplier/PO/invoice → upload image → extraction → verify data → inspect → validate → outcome.
- Real API calls to existing `/api/products`, `/api/extract` and `/api/deliveries/check` endpoints.
- Editable extracted items, quantity, units, expected base quantity, temperature and visual condition.
- Employer demo approval UI, timeline and product catalogue.
- Tailwind setup plus component-specific CSS for close visual matching.

## IMPORTANT — demo limitations

- Initial deliveries are synthetic example data. Newly submitted deliveries, approvals and activity are **in-memory browser state only**; reload resets them.
- If extraction or validation API is unavailable, the UI uses a **clearly labelled local demo fallback**.
- Image upload calls the existing API's `image_b64` JSON format. PDF processing is not implemented.
- Evidence photos show a filename but are not uploaded or stored.
- SOP content and product editing are not implemented because corresponding backend endpoints do not exist.
- Employee/Admin switch is only a UI simulation. The backend must enforce RBAC before production use.
- Do not upload real supplier/customer/company records during hackathon demo; use synthetic data.

## Backend contract (already present)

- `GET /api/products` returns Product[]
- `POST /api/extract` takes `{image_b64:string}` and returns `{name,quantity,unit}[]`
- `POST /api/deliveries/check` takes `{lines:[{product_id,quantity,unit,temp_c,expected_base_qty}]}` and returns `{checks,needs_approval}`

## Next backend endpoints to coordinate with teammates

- `POST /api/deliveries` save completed check and image metadata
- `GET /api/deliveries` persistent delivery list
- `GET /api/deliveries/{id}` detail + timeline
- `POST /api/deliveries/{id}/decision` manager accept/reject/return with reason
- `GET /api/activity` persistent audit log
- `GET/POST/PUT /api/sops` and product rule management
- Authentication/role middleware (or clearly documented simulation for the MVP)
