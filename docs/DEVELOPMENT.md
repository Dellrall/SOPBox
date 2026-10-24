# SOPBox: development and operations

Everything needed to run, deploy, configure and test SOPBox. The project overview is in the [README](../README.md).

## Accounts and roles

| Role | Can do |
|---|---|
| **Owner** | Everything. The person who creates a workspace. Creates, disables and resets accounts, sets the Telegram chats |
| **Manager** | Edits categories and products (the rules), approves or rejects failed deliveries, reads the activity log |
| **Staff** | Receives deliveries, reads products and SOPs, reads delivery records |

Everyone has a username and password. From **Settings, Sign-in & security**, a person can add quicker ways in, each linked to their own account while signed in (an email typed into SOPBox is never trusted to prove who owns a Google account):

- **Passkey:** fingerprint, face or screen lock on their phone. No username needed at sign-in.
- **Google** and **Telegram:** shown only when configured (see Configuration).
- **Kitchen tablet PIN:** a manager marks a shared tablet in Settings; on it, people tap their name and type a 4 to 8 digit PIN. A PIN works on no other browser, is throttled like a password, and its session lasts 12 hours.

**Telegram team group.** The owner can connect one Telegram group per workspace (Settings, Telegram team group). A bot can't create groups, so the owner creates it, sets "Chat history for new members" to Visible (which makes it a supergroup), and adds the SOPBox bot as an admin with "Invite users via link" and "Ban users". SOPBox then makes one invite link that asks to join and sends it by Telegram message to everyone who has connected Telegram (and to each person when they connect later; it's also in their Settings). Telegram passes each join request to `/api/telegram/webhook`, and the bot approves only a Telegram account linked to an active person in that workspace who hasn't been removed, so a forwarded link lets nobody else in. On the Team page the owner can remove someone for 1 hour, 1 day, 1 week or until let back in. Disabling an account or disconnecting Telegram takes the person out too. The webhook is registered when the group is connected, at the address the owner is using, so connect it from the published site, not the development URL.

Every sign-in is recorded. The app shows "your last sign-in was …" once per session, a sign-in from a new device or method lands in the person's inbox, Settings lists the last 10, and the owner's Team page shows each person's last sign-in. Changes to sign-in methods are in the activity log.

Passwords are hashed with scrypt, sessions are random tokens in an HttpOnly cookie, and five wrong passwords lock an account for 15 minutes. Each workspace's data is separate: every query is scoped to the signed-in workspace, and PostgreSQL Row Level Security enforces the same rule inside the database. Names in the audit log come from the signed-in account, not from anything typed.

## Run it locally

You need Python 3.11 or newer and Node 20 or newer. The database is PostgreSQL. Without installing it, `requirements-dev.txt` includes an embedded one.

```bash
# Terminal 1: a local PostgreSQL. Prints two export lines; copy them into terminal 2.
cd src/backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m app.devdb

# Terminal 2: backend on http://localhost:8000
cd src/backend && . .venv/bin/activate
export DATABASE_URL=...  COOKIE_SECURE=0     # the lines from terminal 1
uvicorn app.main:app --reload --port 8000

# Terminal 3: frontend on http://localhost:5173 (proxies /api to :8000)
cd src/frontend
npm install
npm run dev
```

Open http://localhost:5173 and choose **Create a workspace**. You become the owner of an empty workspace. Add categories and products under **Products & SOP**, then create staff accounts under **Team**.

Reading photos needs a RunPod endpoint (see Configuration). Until then, staff type the lines by hand.

To run as one process, as on Replit: `npm run build` in `src/frontend`, then start uvicorn. It serves the built app and the API on port 8000.

## Deploy on Replit

Replit is mandatory for the challenge. The deployed filesystem is not persistent, which is why the database is PostgreSQL and not a file.

**Accounts and settings you need**

1. **Replit account on a plan that includes Deployments.** Check the current plan and credit rules on replit.com/pricing. Deployments are billed from your plan's credits.
2. **GitHub access for Replit.** Create a Repl by importing `Dellrall/SDCIdea26` from GitHub. Pick the branch you want to deploy. A private repository needs you to grant Replit access.
3. **A Replit PostgreSQL database.** In the Repl, open Tools, then Database, and create a PostgreSQL database. Replit sets `DATABASE_URL`. Confirm the deployment has it too (Deployments, Secrets).
4. **Secrets** (Tools, Secrets, and again on the deployment):

| Secret | Required | Value |
|---|---|---|
| `DATABASE_URL` | Yes | Set by the Replit database. Do not copy it into the repo |
| `RUNPOD_ENDPOINT_ID`, `RUNPOD_API_KEY` | For photo reading | The endpoint id (for example `sriet0cftztbik`) and an API key from your RunPod account (see [`runpod/README.md`](../runpod/README.md)). Without them staff type lines by hand |
| `TELEGRAM_BOT_TOKEN` | For alerts and Telegram sign-in | From @BotFather in Telegram. For sign-in, also send @BotFather `/setdomain` with the app's domain (e.g. `sopbox.replit.app`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For Google sign-in | Google Cloud console, APIs & Services, Credentials, OAuth client ID (Web application). Authorised redirect URI: `https://<your domain>/api/auth/google/callback`, one per domain you use |

   Passkeys need no setup, but belong to the address they were made on: one added on the development URL does not work on the published one.
   Leave `COOKIE_SECURE` unset on Replit: the app then sends the session cookie over HTTPS only.
5. **Deploy.** The `.replit` file builds the frontend and starts the app on port 8000 (Autoscale). Open the deployment URL and choose **Create a workspace**: that first account is the owner.

The app is published at https://sopbox.replit.app.

### Every time you publish an update

The app creates and updates its own tables when it starts. Replit's Publish separately compares
the **development** database (used by Run) with **production** and plans to make production
match. If development is behind the code, Publish proposes dropping production tables and
columns, and with them real data.

1. Pull the latest code (Git pane: refresh, then Pull).
2. Bring the development database up to date: press **Run** and wait for the app, or run the
   **Update dev database** workflow, or in the Shell `cd src/backend && python -m app.migrate`.
3. Publish. The database step should show no changes, or only additions.
4. If it lists any `DROP`, cancel the deployment and repeat step 2. Never choose "Copy your
   development database schema & data to production": it replaces live data.

## Configuration

The backend reads environment variables (Replit Secrets in production). See `src/backend/.env.example`.

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Required | none |
| `COOKIE_SECURE` | `0` allows the session cookie over plain http, for local runs only | `1` |
| `RUNPOD_ENDPOINT_ID`, `RUNPOD_API_KEY` | RunPod endpoint id and API key. Without both, photo reading is off | none |
| `TELEGRAM_BOT_TOKEN` | Bot token. Each workspace owner sets chat ids under Settings. With no token or chat id, alerts are skipped. Also enables "Continue with Telegram" (set the bot's domain with @BotFather `/setdomain`) | none |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth web client. With both, "Continue with Google" appears | none |

Never commit keys. `.env` is git-ignored.

## API

Every route except `/api/health` and the sign-in routes needs a signed-in session. Roles are checked on the server.

| Route | Who | Purpose |
|---|---|---|
| `POST /api/auth/register` | anyone | Create a workspace and its owner (email required), and sign in |
| `POST /api/auth/login` | anyone | Sign in with a username or an email |
| `GET /api/auth/session` | anyone | Who is signed in, or `null` |
| `POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/auth/me`, `POST /api/auth/password` | any signed in | Sign out, who am I, change my name or email, change my password |
| `GET /api/auth/methods` | anyone | Which sign-in buttons to show (Google configured, Telegram bot id) |
| `POST /api/auth/passkeys/login-options`, `POST /api/auth/passkeys/login` | anyone | Sign in with a passkey (WebAuthn, no username) |
| `GET /api/auth/google/start?mode=login\|link`, `GET /api/auth/google/callback` | anyone; `link` needs a session | Google OpenID Connect (code flow with PKCE, state and nonce). Results come back to `/signin` or `/settings` as short codes |
| `POST /api/auth/telegram/login` | anyone | Sign in with Telegram's signed answer (hash checked against the bot token, at most an hour old) |
| `GET /api/auth/kitchen`, `POST /api/auth/kitchen/login` | a marked kitchen tablet | Who has a PIN; sign in with one |
| `GET /api/auth/security` | any signed in | My sign-in methods and last 10 sign-ins |
| `POST /api/auth/passkeys/register-options`, `POST /api/auth/passkeys`, `DELETE /api/auth/passkeys/{id}` | any signed in | Add or remove my passkeys |
| `POST /api/auth/telegram/link`, `DELETE /api/auth/google`, `DELETE /api/auth/telegram`, `PUT /api/auth/pin` | any signed in | Connect or disconnect Telegram/Google; set or remove my PIN |
| `PUT/DELETE /api/workspace/team-group` | owner | Connect (checks the bot's admin rights, makes the join-request link, registers the webhook) or disconnect the Telegram team group |
| `POST /api/users/{id}/team-group/remove`, `POST /api/users/{id}/team-group/let-back` | owner | Remove someone from the team group (`{"hours": 1\|24\|168\|null}`), or let them back in |
| `POST /api/telegram/webhook` | Telegram | Join requests; checked against a secret derived from the bot token |
| `GET/POST /api/kitchen-devices`, `DELETE /api/kitchen-devices/{id}` | manager | Mark this browser as a kitchen tablet; list and remove tablets |
| `GET /`, `GET /signin`, `GET /register`, `GET /settings` | anyone | The app. Signed out, `/` is the welcome page with a walkthrough of one delivery |
| `GET /robots.txt`, `GET /sitemap.xml` | anyone | For search engines. The page itself gets absolute canonical and link-preview URLs from the request's address |
| `GET/POST /api/users`, `PATCH /api/users/{id}` | owner | List, create, and change accounts (role, disable, reset password) |
| `GET/PATCH /api/workspace` | owner | Workspace name and Telegram chat ids |
| `GET /api/products?q=` | any | Products with stock. `q` searches name, category and SOP text |
| `POST /api/products`, `PUT/DELETE /api/products/{id}` | manager | Edit products |
| `PATCH /api/products/{id}` | manager | Archive or restore a product (`{"archived": true}`) |
| `POST /api/products/read-sheet`, `POST /api/products/bulk` | manager | Suggest products from a sheet photo (saves nothing); add reviewed products together, all or none |
| `GET /api/categories`; `POST`, `PUT/DELETE /api/categories/{id}` | any; manager | Categories and their default temperature range |
| `POST /api/extract` | any | Read an order photo into lines, matched to products |
| `POST /api/deliveries` | any | Check a delivery. Passing lines are stocked. Any failure holds it for a manager (approvers get an inbox note). With `purchase_order_id`, lines are checked against that issued order; `tagged_user_ids` tags teammates |
| `GET /api/suppliers`; `POST`, `PUT/PATCH /api/suppliers/{id}` | any; manager | Suppliers; `PATCH` archives or restores |
| `GET /api/purchase-orders?status=`, `GET /api/purchase-orders/{id}` | any | Orders with ordered, received, pending and outstanding quantities per line |
| `POST /api/purchase-orders`, `PUT /api/purchase-orders/{id}` | manager | Create or edit a draft |
| `POST /api/purchase-orders/{id}/issue`, `.../cancel`, `POST /api/purchase-orders/low-stock-draft` | manager | Issue, cancel (only with no deliveries), or draft from low stock |
| `GET /api/deliveries?status=`, `GET /api/deliveries/{id}` | any | Read deliveries |
| `POST /api/deliveries/{id}/decision` | manager | Accept, reject or return a held delivery |
| `POST /api/deliveries/{id}/tags`, `DELETE /api/deliveries/{id}/tags/{user_id}` | any who can read deliveries | Tag or untag teammates; `@username` in a photo comment also tags |
| `GET /api/audit?actor_id=` | manager | Audit log, newest first; `actor_id` shows one person's actions by account |
| `GET /api/team` | any signed in | Active teammates, for tagging |
| `GET /api/team/accountability` | owner | Per-person counts from the audit log |
| `GET /api/inbox`, `POST /api/inbox/read` | any signed in | My notifications (tagged, approval needed, decision, comment); mark some (`ids`) or all read |

"manager" includes the owner. The API docs page is switched off because its script loads from a CDN, which the strict Content-Security-Policy blocks.

## Tests

```bash
pip install -r src/backend/requirements-dev.txt
python -m pytest          # from the repository root
```

The suite starts an embedded PostgreSQL, so it needs no install, network, GPU or Telegram account. The app connects as an ordinary database role, so Row Level Security applies to every test. It covers sign-up, sign-in, roles, workspace isolation (including a direct database check), the rules, catalogue and delivery flows, decisions that cannot be made twice, the model-reply parser, the hourly cap on model calls, alerts that never break a delivery, and the security headers.

### Phone UI tests

```bash
cd src/frontend
npm ci && npx playwright install chromium
npm run test:ui           # PYTHON=path/to/python if the backend's packages aren't in python3
```

Playwright builds the frontend, starts the app on a throwaway database (`e2e/server.py`) and opens every page as owner, manager and staff on a 360px Android and a 320px iPhone SE. Each page must fit the screen with no sideways scrolling, and the phone flows are tapped through: password sign-in and the last sign-in notice, the menu and inbox, stock count categories, and kitchen tablet PIN sign-in. `npx playwright show-report` shows a screenshot of every page. GitHub Actions runs them on every pull request.

## Known limits

- The first photo after the endpoint has been idle waits for a cold start (a few minutes). Staff can type the lines instead.
- Anyone can create a workspace. An address can create 10 an hour. Accounts store an email and can sign in with it, but the app sends no email yet, so a forgotten owner password cannot be reset by the app: it takes a database change.
- The sign-in lockout counter is in memory, so it is per server process.
- The order photo is not stored. The audit log records readings and decisions, not the image.
- Manual stock corrections, barcode scanning and event-based SOPs (peak hour, new starter) are not built.
