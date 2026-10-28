<p align="center">
  <img src="src/frontend/public/SOPBox_Logo.jpeg" alt="SOPBox logo: a delivery box with vegetables and a fish" width="180">
</p>

<h1 align="center">📦 SOPBox</h1>

<p align="center"><b>AI reads. Rules decide. Humans approve.</b></p>

<p align="center">
  <a href="https://github.com/Dellrall/SOPBox/actions/workflows/backend-tests.yml"><img src="https://github.com/Dellrall/SOPBox/actions/workflows/backend-tests.yml/badge.svg" alt="Backend tests"></a>
  <a href="https://github.com/Dellrall/SOPBox/actions/workflows/ui-tests.yml"><img src="https://github.com/Dellrall/SOPBox/actions/workflows/ui-tests.yml/badge.svg" alt="Phone UI tests"></a>
  <a href="https://sopbox.replit.app"><img src="https://img.shields.io/badge/live%20demo-sopbox.replit.app-2E7D32?logo=replit&logoColor=white" alt="Live demo"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.11%20%7C%203.12-3776AB?logo=python&logoColor=white" alt="Python 3.11 | 3.12">
  <img src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/React%2018-20232A?logo=react&logoColor=61DAFB" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Tailwind%20v4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS v4">
  <img src="https://img.shields.io/badge/PostgreSQL-Row%20Level%20Security-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL with Row Level Security">
  <br>
  <img src="https://img.shields.io/badge/RunPod-serverless%20GPU-673AB7" alt="RunPod serverless GPU">
  <img src="https://img.shields.io/badge/vLLM-Qwen3--VL--8B%20FP8-FF6F00" alt="vLLM serving Qwen3-VL-8B FP8">
  <img src="https://img.shields.io/badge/Telegram-Bot%20API-26A5E4?logo=telegram&logoColor=white" alt="Telegram Bot API">
  <img src="https://img.shields.io/badge/tests-305%20pytest%20%C2%B7%2028%20Playwright-success" alt="305 pytest and 28 Playwright tests">
  <img src="https://img.shields.io/badge/SDG-12.3%20%C2%B7%208-E5243B" alt="SDG 12.3 and 8">
</p>

> **SOPBox** is a phone-first receiving-control platform for small food and beverage outlets. A vision-language model on a serverless GPU reads every supplier delivery order, a deterministic rules engine decides pass or fail, and a human-in-the-loop approval flow puts a manager in charge of every exception, with a full audit trail and multi-tenant isolation enforced down to the database.

---
## 👥 Team Information

| Field                  | Details                                     |
| ---------------------- | ------------------------------------------- |
| **Team Name**          |"Hack into Google, No Mistake"                                      |
| **Team Domain**        | Domain 2                                    |
| **SDG Track (1–17)**   | SDG 12 — Responsible Consumption and Production (target 12.3, food waste); also supports SDG 8 |
| **Team Leader**        | Lye Wei Lun                                      |
| **University**         | Tunku Abdul Rahman University of Management and Technology                                       |
| **Number of Members**  | 5                                           |

## 🔗 Links

| Resource          | Link                                           |
| ----------------- | ---------------------------------------------- |
| GitHub Repository | https://github.com/Dellrall/SOPBox          |
| Live Demo         | https://sopbox.replit.app                      |
| RunPod Endpoint   | https://api.runpod.ai/v2/sriet0cftztbik        |
| Slide Deck        |https://docs.google.com/presentation/d/19grJuodMn0e-vGj9hfSoVCfKdqcKE-roTmU2JJK2dPU/edit?usp=sharing|
| Demo Video        |https://youtu.be/mJNwTxj6-pY                                        |
---

## 🧭 Overview

### 🔥 Problem

Small F&B outlets lose stock and money when deliveries arrive. Frozen and chilled goods are accepted outside their safe temperature, pack quantities are miscounted (250 pcs per bundle, 12 packets per box) so stock and orders drift apart, and new staff don't know the receiving steps. Nothing is recorded, so the same mistakes repeat and spoiled food is thrown away later.

### 💡 Solution

SOPBox turns receiving into one guided check on a phone. Staff photograph the delivery order and an open-weight vision model on a RunPod GPU reads every line; anything unclear is flagged, never guessed. Staff confirm the lines and enter the probe temperature. Rules in code (not the AI) check temperature, pack conversion and the quantity still due on the purchase order. Any failed line holds the delivery until a manager accepts, rejects or returns it, and every step is logged. **AI reads. Rules decide. Humans approve.**

### ✨ Key Features

- **Receiving check** — take or choose a photo of the delivery order; the AI fills in the lines for staff to confirm, with probe temperatures, stock photos and teammate tagging.
- **Rules and approvals** — failed lines hold the delivery for a manager, who is notified in the app inbox and on Telegram.
- **Products & SOP cards** — temperature ranges, pack sizes and step-by-step SOPs per product. An **AI SOP writer** drafts steps from a manager's notes, and a second pass checks them.
- **Import from a supplier sheet** — photograph a product or SOP sheet; the AI suggests products and SOPs for a manager to correct and add.
- **Purchase orders and stock counts** — deliveries are checked against what is still due; draft orders from low stock; stock counts with an Excel template.
- **Activity log and roles** — owner, manager and staff each see only what their role needs; every action is recorded.
- **Easy sign-in** — password, passkey, Google, Telegram, or a PIN on a shared kitchen tablet.
- **Built for phones** — every page is tested at 320px and 360px wide.

### 🛠️ Tech Stack

| Layer         | Technology                   |
| ------------- | ---------------------------- |
| Frontend      | React 18, TypeScript, Vite, Tailwind CSS |
| Backend       | Python, FastAPI              |
| Database      | PostgreSQL (Replit), with Row Level Security per workspace |
| AI / Compute  | RunPod Serverless (GPU), vLLM, Qwen3-VL-8B-Instruct (FP8) |
| Notifications | Telegram Bot API             |
| Hosting / Dev | Replit (Deployments, Secrets, PostgreSQL) |

---

## 🏁 Final Round: How SOPBox Meets Each Criterion

### The full journey, live

| Step | What happens in SOPBox | Where to see it |
| ---- | ---------------------- | --------------- |
| **Trigger** | A supplier delivery arrives. Staff open **Receiving check** and take or choose a photo of the delivery order | Receiving check |
| **Data** | Qwen3-VL-8B on RunPod reads every line; unclear values are flagged, never guessed. Staff confirm the lines and enter the probe temperature | Receiving check |
| **Decision** | The rules engine, in code and not the AI, checks each line: temperature range, pack-to-unit conversion, quantity still due on the purchase order, unknown products | Result screen |
| **Approval** | Any failed line holds the whole delivery. A manager accepts, rejects or returns it, with a reason | Approvals |
| **Action** | Accepted goods are added to stock and the purchase order balance updates. The manager is alerted in the inbox and on Telegram, and staff hear the decision | Stock, Purchase orders, Telegram |
| **Result** | The delivery record, the activity log and the dashboard show the outcome | Delivery records, Activity log, Dashboard |

### Technical Execution

- **305 backend tests and 28 phone UI tests**, both run in GitHub Actions on every change (badges above).
- **Multi-tenant isolation twice over:** every query is scoped to the signed-in workspace, and PostgreSQL Row Level Security enforces it inside the database.
- **AI output is untrusted input:** parsed, validated and confirmed line by line by staff; the verdict comes from rules, never the model. An hourly cap bounds GPU spend.
- **Built to be cheap and fast:** the GPU scales to zero when idle; responses are gzip-compressed; each request makes as few database round trips as possible.
- **Real sign-in security:** scrypt passwords, account lockout, passkeys, Google and Telegram sign-in, and a recorded history of every sign-in.

### Design & UX

- **Phone-first:** every page is tested on 320px and 360px screens with no sideways scrolling.
- **Built for a busy kitchen:** a shared tablet signs people in with a name tap and a PIN; photos can be taken with the camera or chosen from the gallery; if the AI is asleep, staff can always type the lines.
- **Plain language everywhere:** the activity log reads as sentences, not codes; the dashboard shows only the newest notification; every product has a step-by-step SOP card.
- **Each role sees only what it needs:** owner, manager and staff menus differ.

### Feasibility as a Business

- **Measured benefit:** SOPBox records every delivery checked, accepted, rejected, returned and held, plus low stock and each person's actions, so an outlet can see failures stopped at the door. Pilot results: _TBC_.
- **Many SMEs at once:** any business signs up and gets its own isolated workspace on the same deployment, with nothing to install. Orbyte: SOPBox uses the Orbyte-style design; listing it as an Orbyte module with shared sign-in is the next step (_TBC_).
- **Cost to run:** one AI read takes about 2 seconds on a US$0.69/hour GPU, roughly US$0.0004; the first read after the GPU sleeps costs about US$0.035. An idle outlet costs nothing in GPU time.
- **Pricing:** _TBC_.
- **Privacy:** each business's data is separated inside the database. Delivery-order photos go only to our own RunPod endpoint running an open-weight model, are not stored, and are not used for training; no third-party AI API sees them. Stock photos stay in that business's workspace for its managers. Keys live in Replit Secrets, never in the code.

### Communication: who answers what in Q&A

| Topic | Answered by |
| ----- | ----------- |
| Business case, pricing, Orbyte | Lye Wei Lun (Team Lead) |
| Rules engine, data and privacy | Leong Zoe Yee (Backend) |
| The app and user experience | Ng Sze Ya (Frontend) |
| The AI model and RunPod | Puteri A'ina Auji Farzana (AI / RunPod) |
| Design and testing | Siow Wei Yik (Design & QA) |

---

## 🗂️ Project Structure

```
.
├── docs/
│   └── DEVELOPMENT.md       # Full setup, deployment, configuration, API and test details
├── runpod/
│   └── README.md            # RunPod endpoint settings (official vLLM worker, no custom handler)
├── src/
│   ├── backend/
│   │   ├── app/             # FastAPI app: accounts, rules, deliveries, AI client, Telegram
│   │   ├── requirements.txt # Python dependencies
│   │   └── .env.example     # Example environment variables
│   └── frontend/
│       ├── src/             # React pages and components
│       └── e2e/             # Playwright phone UI tests
├── submission/              # Required submission documents (PDFs)
├── tests/                   # pytest suite
├── .github/workflows/       # Backend and phone UI tests on every pull request
├── .replit                  # Replit run and deploy configuration
├── LICENSE
└── README.md
```

### 🏗️ Architecture

```mermaid
flowchart LR
  subgraph Client["📱 Phone / tablet"]
    UI["React 18 + TypeScript<br/>Tailwind v4 · Vite"]
  end
  subgraph Replit["🟠 Replit Deployment (Autoscale)"]
    API["FastAPI<br/>REST API + SPA"]
    RULES["⚖️ Rules engine<br/>temperature · pack units · PO balance"]
    DB[("🐘 PostgreSQL<br/>Row Level Security")]
  end
  subgraph RunPod["🟣 RunPod Serverless (scale to zero)"]
    VLLM["vLLM worker"]
    VLM["🧠 Qwen3-VL-8B FP8"]
  end
  TG["✈️ Telegram Bot API<br/>alerts · team group"]

  UI -->|HTTPS, gzip| API
  API --> RULES
  API --> DB
  API -->|photo + prompt| VLLM
  VLLM --> VLM
  VLLM -->|JSON reply, untrusted| API
  API -->|alerts, join approvals| TG
```

The model's reply is treated as untrusted input: parsed, validated, and confirmed line by line by staff before anything is saved. The pass/fail verdict comes from the rules engine, never from the model.

---

## 🚀 How to Run

### Option 1 — Run on Replit (Recommended)

1. Import this repository via **Create Repl → Import from GitHub** (`Dellrall/SOPBox`).
2. Create a PostgreSQL database (**Tools → Database**). Replit sets `DATABASE_URL`.
3. Open the **Secrets** tab (🔒) and add the variables in `src/backend/.env.example`:
   - `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` — photo reading and the SOP writer
   - `TELEGRAM_BOT_TOKEN` — optional, for alerts and Telegram sign-in
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — optional, for Google sign-in
4. Click **Run**. The `.replit` file builds the frontend and starts the app on port 8000.
5. Open the app and choose **Create a workspace**. You become its owner.

Without the RunPod secrets, everything works except photo reading: staff type the lines by hand.

### Option 2 — Run Locally

Needs Python 3.11+ and Node 20+. An embedded PostgreSQL is included, so nothing else to install.

```bash
# 1. Clone the repository
git clone https://github.com/Dellrall/SOPBox.git
cd SOPBox

# 2. Backend: virtual environment and dependencies
cd src/backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt

# 3. Start a local database; it prints DATABASE_URL to export in the next terminal
python -m app.devdb

# 4. In a second terminal: run the backend on http://localhost:8000
cd src/backend && source .venv/bin/activate
export DATABASE_URL=...  COOKIE_SECURE=0    # the lines printed in step 3
uvicorn app.main:app --port 8000

# 5. In a third terminal: run the frontend on http://localhost:5173
cd src/frontend && npm install && npm run dev
```

### 🧪 Run Tests

```bash
python -m pytest                       # 305 backend tests, from the repository root (runs in CI)

cd src/frontend && npm ci && npx playwright install chromium
npm run test:ui                        # 28 phone UI tests (320px and 360px screens)
```

---

## 🟠 How We Use Replit *(Required)*

- **Development:** the team imports this GitHub repository into a shared Repl and runs it with **Run**.
- **Hosting:** the app is published with **Replit Deployments (Autoscale)** at https://sopbox.replit.app. One FastAPI process serves the built React app and the API.
- **Database:** **Replit PostgreSQL** stores every workspace's data. Row Level Security keeps each business's data separate inside the database.
- **Secrets:** the RunPod, Telegram and Google keys are kept in **Replit Secrets**, never in the code.

📄 Proof of use: [`submission/SDC2026_Hack into Google, No Mistake_Replit_POU.pdf`](submission/SDC2026_Hack%20into%20Google%2C%20No%20Mistake_Replit_POU.pdf)

## 🟣 How We Use RunPod *(Required)*

- **Workload:** all AI runs on a RunPod GPU: reading delivery-order photos, reading supplier sheets, and writing and checking SOPs.
- **Setup:** a **RunPod Serverless endpoint** (`sriet0cftztbik`) runs RunPod's official vLLM worker with **Qwen3-VL-8B-Instruct (FP8)** on a 24 GB GPU. It scales to zero, so it costs nothing when idle. Settings are in [`runpod/README.md`](runpod/README.md).
- **Integration:** the Replit app sends jobs with `RUNPOD_API_KEY` and `RUNPOD_ENDPOINT_ID` (`/run`, then polls `/status`), treats the reply as untrusted input, validates it, and has staff confirm every line. An hourly cap bounds GPU spend.

Example request (OpenAI-style chat through the vLLM worker):

```bash
curl -X POST https://api.runpod.ai/v2/$RUNPOD_ENDPOINT_ID/runsync \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {"openai_route": "/v1/chat/completions",
       "openai_input": {"model": "sopbox-reader", "temperature": 0,
         "messages": [{"role": "user", "content": "Write 3 steps for receiving frozen chicken."}]}}}'
```

📄 Proof of use: [`submission/SDC2026_Hack into Google, No Mistake_Runpod_POU.pdf`](submission/SDC2026_Hack%20into%20Google%2C%20No%20Mistake_Runpod_POU.pdf)

---

## 🧗 Challenges & Learnings

- **AI that guesses is dangerous.** Delivery orders have crossed-out, smudged and handwritten quantities, and a wrong guess means wrong stock. We ask the model to leave unclear values blank and flag them, keep the pass/fail decision in code, and have staff confirm every line.
- **A small model as a checker.** An open "list the problems" prompt for the SOP checker invented problems and sometimes ran on forever. Asking for a yes/no verdict on each step fixed it.
- **GPU cost and cold starts.** With a US$25 budget we chose serverless, scaled to zero, and FP8 weights on a 24 GB GPU. The trade-off is a 2–3 minute wait on the first photo after idle, so staff can always type lines by hand. Some GPU types were throttled mid-load and are now excluded.
- **Keeping businesses' data apart.** Filtering in code wasn't enough on its own, so PostgreSQL Row Level Security enforces it in the database as well, and tests check it directly.
- **Publishing safely.** Replit's Publish once proposed dropping production tables because the development database was behind. We learned to update development first and never accept a `DROP`.
- **Phones first.** Automated phone-size tests caught layout bugs (pages scrolling sideways, the inbox opening behind the page) that desktop testing missed.

## 🔭 Future Improvements

- [ ] Light LoRA fine-tune on synthetic delivery orders, swapped in behind the same endpoint name
- [ ] Barcode scanning to pick products
- [ ] Daily task lists per role and event-based SOPs (peak hour, new starter)
- [ ] Chat assistant that answers SOP questions
- [ ] Demand forecasting, POS integration and multi-outlet support

## 🤝 Team

| Name        | Role                | GitHub                                   |
| ----------- | ------------------- | ---------------------------------------- |
| Lye Wei Lun| Team Lead|https://github.com/Dellrall|
| Leong Zoe Yee| Backend |https://github.com/LEONGZOEYEE|
| Ng Sze ya| Frontend|https://github.com/NgSzeYa|
| Puteri A'ina Auji Farzana | AI / RunPod|https://github.com/TheTN-G|
| Siow Wei Yik|Design & QA|https://github.com/Weiyik88|

### 📚 Third-party code, models and assets

- **Open source:** FastAPI, Uvicorn, Pydantic, httpx, psycopg, openpyxl, py_webauthn, React, Vite, TypeScript, Tailwind CSS, Lucide icons, SimpleWebAuthn, Plus Jakarta Sans (Fontsource), pytest, Playwright, vLLM (RunPod worker-v1-vllm).
- **Pre-trained model:** Qwen3-VL-8B-Instruct by the Qwen team (Apache 2.0), used as released.
- **Images:** dashboard kitchen photo by Yanhao Fang on Unsplash; SDG icons © United Nations.

---

## ✅ Submission Checklist

- [x] Team name, domain (Domain 1 / Domain 2) and SDG track filled in
- [x] Slide deck link added
- [x] Demo video link added
- [x] Replit used, with proof of use in `submission/`
- [x] RunPod used, with proof of use in `submission/`
- [x] Preliminary submission completed (`SDC2026_Hack into Google, No Mistake_Preliminary.pdf`)
- [x] Technology declaration completed (`SDC2026_Hack into Google, No Mistake_TechDeclaration.pdf`)
- [x] Submission files renamed with your team name (replace `TeamName`)
- [x] "How to Run" steps verified
- [x] No API keys or secrets committed to the repository

## 📄 License

This project is licensed under the [Apache License 2.0](LICENSE).
