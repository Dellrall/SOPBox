# How SOPBox meets each judging criterion

### The full journey, live

| Step | What happens in SOPBox | Where to see it |
| ---- | ---------------------- | --------------- |
| **Trigger** | A supplier delivery arrives. Staff open **Receiving check** and take or choose a photo of the delivery order | Receiving check |
| **Data** | Qwen3-VL-8B on RunPod reads every line; unclear values are flagged, never guessed. Staff confirm the lines and enter the probe temperature | Receiving check |
| **Decision** | The rules engine, in code and not the AI, checks each line: temperature range, pack-to-unit conversion, quantity still due on the purchase order, unknown products | Result screen |
| **Approval** | Any failed line holds the whole delivery. A manager accepts, rejects or returns it, with a reason | Approvals |
| **Action** | Accepted goods are added to stock in the chosen storage area, the purchase order balance updates and the delivered price is recorded. The manager is alerted in the inbox and on Telegram, and staff hear the decision | Stock, Purchase orders, Telegram |
| **Result** | The delivery record, the activity log and the dashboard show the outcome, including any price rise | Delivery records, Activity log, Dashboard |

### Technical Execution

- **418 backend tests and 98 phone and tablet UI test runs**, both run in GitHub Actions on every change (badges in the README).
- **AI writes words, code does the maths:** reorder amounts, usage rates, gap values and price changes are computed in Python; the model only reads documents and explains results. Every AI feature still works when the GPU or the AI service is off. The assistant reads only through fixed tools with the asker's access, treats record text as data (prompt injection), and only suggests: actions run when a person taps them.
- **Multi-tenant isolation twice over:** every query is scoped to the signed-in workspace, and PostgreSQL Row Level Security enforces it inside the database.
- **AI output is untrusted input:** parsed, validated and confirmed line by line by staff; the verdict comes from rules, never the model. An hourly cap bounds GPU spend.
- **Built to be cheap and fast:** the GPU scales to zero when idle; responses are gzip-compressed; pages load on demand and recent data is reused, so the first screen downloads about 95 KB.
- **Real sign-in security:** scrypt passwords, account lockout, passkeys, Google and Telegram sign-in, and a recorded history of every sign-in.

### Design & UX

- **Phone-first:** a bottom bar puts Dashboard, Approvals, Receive (a raised button in the middle), Stock and More under the thumb; filters fold away; every page is tested on small phones and tablets with no sideways scrolling.
- **Built for a busy kitchen:** a shared tablet signs people in with a name tap and a PIN; photos can be taken with the camera or chosen from the gallery; if the AI is asleep, staff can always type the lines.
- **Plain language everywhere:** the activity log reads as sentences, not codes; the dashboard shows four numbers and the newest notification; every product has a step-by-step SOP card; the assistant answers in plain English or Malay and gives a button to the right page; every record prints as a clean PDF.
- **Each role sees only what it needs:** owner, manager and staff menus differ.

### Feasibility as a Business

- **Measured benefit:** SOPBox records every delivery checked, accepted, rejected, returned and held, the RM value of count gaps and price rises, so an outlet can see what it saved. Malaysian figures and the formulas behind them are in [docs/IMPACT.md](IMPACT.md) (a café buying RM20,000 a month could save RM6,240 to RM14,352 a year). Pilot results: _TBC_.
- **Many SMEs at once:** any business signs up and gets its own isolated workspace on the same deployment, with nothing to install. Chains add outlets, link branches to head office, and connect a till through API keys. The frontend is built on the Orbyte template.
- **Cost to run:** one AI read takes about 2 seconds on a US$0.69/hour GPU, roughly US$0.0004; the first read after the GPU sleeps costs about US$0.035. An idle outlet costs nothing in GPU time.
- **Pricing:** Free for one outlet and up to 50 products (one free workspace per business). Pro is charged by use: in a month with work recorded, RM49 for the first outlet plus RM29 for each further outlet used (launch price for 12 months, then RM89 and RM49); a month with no work costs nothing. The app counts active outlets from the activity log and shows the month's bill in Settings. Priority support RM190 a year, free in the first year; custom work quoted per task from RM100; Enterprise by quote. Lifetime: RM2,990 once per outlet, approved by the team, then only AI reading is charged at RM0.30 a read. AI reading costs about RM0.15 a read, so a Pro outlet costs roughly RM10 a month to run.
- **Privacy:** each business's data is separated inside the database. Delivery-order photos go only to our own RunPod endpoint running an open-weight model, are not stored, and are not used for training; no third-party AI API sees them. Sales reports a person chooses to read with AI, and questions to the assistant, go to a second OpenAI-compatible service (KrackedDev); the assistant only reads through fixed tools with the asker's access and only suggests actions, which run when a person taps them. Stock photos stay in that business's workspace for its managers. Keys live in Replit Secrets, never in the code.

### Communication: who answers what in Q&A

| Topic | Answered by |
| ----- | ----------- |
| Business case, pricing, Orbyte | Lye Wei Lun (Team Lead) |
| Rules engine, data and privacy | Leong Zoe Yee (Backend) |
| The app and user experience | Ng Sze Ya (Frontend) |
| The AI model and RunPod | Puteri A'ina Auji Farzana (AI / RunPod) |
| Design and testing | Siow Wei Yik (Design & QA) |

Back to the [README](../README.md).
