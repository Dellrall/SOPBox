# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working on SOPBox. People should start with the [README](README.md); the full operations guide is [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

SOPBox is a phone-first web app for food and beverage outlets: staff photograph a delivery order, an AI model reads it into lines, and code checks each line against the outlet's rules (temperature, pack, expiry), stocks what passes and holds the rest for a manager.

## Rules that matter most

1. **The AI only writes words. Code does the maths.** Quantities, stock, prices, reorder amounts and pass/fail checks are computed in Python. Model output is parsed and validated (`app/extraction.py`, `parse_model_output`) and never trusted as a number without a check. Keep it that way.
2. **Every workspace is isolated by Postgres Row Level Security.** Use the request's `Conn` dependency in `app/main.py`; it is already scoped to the signed-in workspace. A new table that holds workspace data must be added to `RLS_TABLES` in `app/db.py`.
3. **Schema changes are additive.** `app/db.py` `SCHEMA` runs on every start: use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Never drop or rename a column or table; production data lives there.
4. **Phone first.** Every page must fit a 320px wide screen with no sideways scrolling. Playwright checks this.
5. **Plain language** in the UI: short labels, no jargon, few subtitles. Staff may read English or Malay as a second language.
6. **Never commit secrets.** `.env` is git-ignored; production keys live in Replit Secrets.
7. **Orbyte is the frontend template.** Keep its styling base and credit.

## Set up locally

Needs Python 3.11+ and Node 20+. No Postgres install: `requirements-dev.txt` includes an embedded one.

```bash
# Terminal 1: backend packages and a local database (prints DATABASE_URL and COOKIE_SECURE exports)
cd src/backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m app.devdb

# Terminal 2: API on http://localhost:8000
cd src/backend && . .venv/bin/activate
export DATABASE_URL=...  COOKIE_SECURE=0     # the lines printed in terminal 1
uvicorn app.main:app --reload --port 8000

# Terminal 3: frontend on http://localhost:5173 (proxies /api to :8000)
cd src/frontend && npm install && npm run dev
```

Open http://localhost:5173, choose **Create a workspace**, and you are its owner. Tables are created at start-up (`python -m app.migrate` does it on its own).

Without RunPod keys, photo reading, the SOP writer, "Explain with AI" and the Ask helper are off or fall back; everything else works. Sales report reading uses a second, OpenAI-compatible service: put `AI_API_KEY` (and optionally `AI_BASE_URL`, `AI_MODEL`) in `src/backend/.env`; only `AI_` lines are loaded from it. Without it, people match sales lines by hand and the assistant falls back to the fixed questions. Optional variables are listed in `src/backend/.env.example` and in docs/DEVELOPMENT.md, Configuration.

One process, as in production: `npm run build` in `src/frontend`, then uvicorn serves the built app and the API on port 8000.

## Project structure

```
src/backend/app/        FastAPI app
  main.py               every route, its auth dependency, and the role/section aliases (Conn, User, OwnerOnly, ManagerUp, StocktakeReader...)
  models.py             Pydantic request and response models
  db.py                 schema (SCHEMA), RLS_TABLES, connection pool, scope_to_workspace
  config.py             environment variables (get_settings)
  auth.py, accounts.py  sessions, passwords, roles, section access
  passkeys.py, sso.py, mfa.py, kitchen.py   passkeys, Google/Telegram, authenticator two-step, kitchen tablet PIN
  rules.py              the delivery checks (pure Python), including expiry (date missing, expired, too few days left)
  deliveries.py         receiving, holds, approvals, photos, tags; accepted lines become lots
  lots.py               expiry lots: per product and storage area, earliest expiry used first (a SQL window, so sales, counts and transfers need no lot code), alerts, disposal
  extraction.py         RunPod client and the model-reply parser
  catalogue.py          categories, products, SOP cards
  purchasing.py         suppliers, purchase orders, reorder suggestions
  stocktakes.py, insights.py   stock counts, "what stands out", price rises
  locations.py, sales.py, hq.py, apikeys.py   outlets and storage (`mine`, `at_outlet`: rows of the picked outlet only), sales (sales sheet like the count sheet; a named lot is used instead of the earliest expiry), HQ branch links, till API
  sales_ai.py           sales by menu item: read any report (AI), match by code, saved match, then AI suggestion or a question; a person confirms, code works out totals, matches are remembered
  reports.py            reports: one SQL per kind over the outlet worked in, filters, totals in code
  ask.py                the in-app helper's fixed questions
  assistant.py          the assistant chat on the AI_* service: read-only tools with the asker's access, page buttons, actions only on a tap; tool text fenced as data (prompt injection)
  notifications.py, team_group.py, inbox.py   Telegram alerts, Telegram team group, in-app inbox
  plans.py              plans and every price shown (None prints "TBC"); Free holds FREE_PRODUCTS; Pro bills only outlets with work that month (USAGE_ACTIONS); lifetime per outlet; every paid AI call goes through `plans.metered` (monthly AI_MONTH allowance, counted in `ai_uses`)
  plan_codes.py, set_plan.py, reset_mfa.py, migrate.py, devdb.py   command-line tools (python -m app.<name>)
src/frontend/src/       React + Vite + TypeScript + Tailwind v4
  App.tsx               signed-in shell: PageId, NAV, menu groups, phone bottom bar (TAB_ORDER)
  api.ts                fetch wrapper (the `api` object, ApiError)
  types.ts              types matching app/models.py
  ui.tsx                shared classes and components (cardClass, inputClass, PageTitle, buttons)
  Print.tsx             PrintButton: print / PDF of a PO, transfer, stock count or lot labels
  OutletSwitch.tsx, StorageSelect.tsx   the outlet picked in the sidebar; storage lists show only its areas
  index.css             theme tokens (@theme: --color-brand-*)
  Landing.tsx, Site.tsx, Docs.tsx, Pricing.tsx   public site
  Help.tsx              GUIDES, shown in-app and on the public Docs page
  one file per page     Receive, Records, Approvals, Products, PurchaseOrders, Stocktake, StockMoves, Expiry, Team, Settings...
  SalesReader.tsx       the "Read any sales report" part of Stock & sales
src/frontend/e2e/       Playwright tests (phones and tablets)
tests/                  pytest suite (embedded Postgres, RLS on)
runpod/                 the vision model endpoint setup
docs/                   DEVELOPMENT.md (operations and API), IMPACT.md (business case)
```

## Make a change

1. Branch from `main`. Read the code you will touch and match its style: small functions, short comments that explain why, no extra abstractions.
2. Backend feature: logic in its module, models in `models.py`, the route in `main.py` with the narrowest dependency (`OwnerOnly`, `ManagerUp`, or a section reader/editor). Add a pytest in `tests/` for new logic, money, permissions or parsing.
3. Frontend feature: types in `types.ts`, calls through `api.ts`, components from `ui.tsx`. A new page needs an id in `PageId`, an entry in `NAV` and a menu group in `App.tsx`; add it to `TAB_ORDER` only if it belongs in the bottom bar. Update `GUIDES` in `Help.tsx` when a user-facing step changes.
4. Run all checks (next section). They must pass before a pull request.
5. Open a pull request against `main`. GitHub Actions runs pytest and Playwright on every pull request.
6. Update docs/DEVELOPMENT.md (API table, Configuration) and the README when you add a route, a variable or a feature.

## Checks

```bash
python -m pytest -q                           # from the repository root; needs requirements-dev.txt
cd src/frontend && npx tsc -b                 # types
npm ci && npx playwright install chromium
npm run test:ui                               # phone and tablet UI; PYTHON=path/to/python if needed
```

Playwright builds the app, starts it on a throwaway database (`e2e/server.py`) and runs on small Android, iPhone SE and iPad (upright and sideways). In tests, open the menu with `getByRole("button", { name: "More", exact: true })`.

## Customize

- **Brand colours:** `--color-brand-*` in `src/frontend/src/index.css`. Logo and icons in `src/frontend/public/`.
- **Prices, plans and contact details:** the top of `src/backend/app/plans.py`.
- **Default checks:** per category (temperature range) and per product (pack, expiry) in the app under **Categories & storage** and **Products & SOP**; the check logic is `app/rules.py`.
- **What the model reads:** `PROMPT` in `app/extraction.py`; the parser below it must still validate every field.
- **Landing page and guides:** `Landing.tsx` (FEATURES), `Help.tsx` (GUIDES).
- **Bottom bar:** `TAB_ORDER` in `App.tsx`.
- **Alerts:** `app/notifications.py` (Telegram). Owners set chat ids in Settings.

## Gotchas

- `SCHEMA` in `app/db.py` is an f-string: a `{` or `}` in an SQL comment breaks start-up.
- Receive stays mounted while other pages show, so element ids must be unique app-wide (prefix them, e.g. `lot-qty-`), and it reloads on `active` and on an outlet switch (`reload`), not on `key`. Other pages remount through `key={visit}`.
- A new audit action needs a name in `Activity.tsx` (`tests/test_activity_names.py` checks).
- Notification kinds are a CHECK constraint: edit the original `notifications_kind_check` in place; a second DROP/ADD fails on restart.
- Two AI services: RunPod (delivery photos, SOP writer, Ask, explanations) and `AI_*` (sales, `app/sales_ai.py`). Both only write words; every id and amount in a reply is checked in code. Never log or print keys.
- Playwright leaves throwaway databases in `/tmp/sopbox-e2e-*` when it stops the server; clear them if `/tmp` fills. To keep them elsewhere: `PYTHON="env TMPDIR=<dir> python" npx playwright test`.

## API

JSON over HTTPS under `/api`. A session cookie (HttpOnly) after `POST /api/auth/login` or register; roles and section access are checked on the server. Till/POS integrations use `/api/v1/*` with an API key from Settings: `POST /api/v1/sales` by product code, `POST /api/v1/sales/items` by item name (unknown items wait for a person on Stock & sales). The interactive API docs page is switched off (strict Content-Security-Policy), so the full route table is in [docs/DEVELOPMENT.md, API](docs/DEVELOPMENT.md#api) and the source of truth is `app/main.py` with `app/models.py`.

## Deploy

Replit Autoscale, configured in `.replit`. Before Publish: pull `main` and run `python -m app.migrate` (or press Run once) so the development database is current. If Publish proposes dropping tables or columns, cancel. Secrets are listed in `replit.md`.

## Known gaps

- The Telegram bot points itself at the server when the owner opens Settings or someone connects Telegram; after moving to a new address, do one of those once.
- The app sends no email yet; a lost owner password needs a database change.
- Payments are not taken in the app; plans are turned on by codes (`python -m app.plan_codes`). The monthly bill by use is shown, not charged; AI reads on lifetime plans are not metered yet.
- One free workspace per business is a notice at registration; duplicates are not detected.
- Workspaces are not grouped into organizations yet; HQ branch links are the closest.
