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

- **396 backend tests and 92 phone and tablet UI test runs**, both run in GitHub Actions on every change (badges in the README).
- **AI writes words, code does the maths:** reorder amounts, usage rates, gap values and price changes are computed in Python; the model only reads documents and explains results. Every AI feature still works when the GPU is off.
- **Multi-tenant isolation twice over:** every query is scoped to the signed-in workspace, and PostgreSQL Row Level Security enforces it inside the database.
- **AI output is untrusted input:** parsed, validated and confirmed line by line by staff; the verdict comes from rules, never the model. An hourly cap bounds GPU spend.
- **Built to be cheap and fast:** the GPU scales to zero when idle; responses are gzip-compressed; pages load on demand and recent data is reused, so the first screen downloads about 95 KB.
- **Real sign-in security:** scrypt passwords, account lockout, passkeys, Google and Telegram sign-in, and a recorded history of every sign-in.

### Design & UX

- **Phone-first:** a bottom bar puts Dashboard, Approvals, Receive (a raised button in the middle), Stock and More under the thumb; filters fold away; every page is tested on small phones and tablets with no sideways scrolling.
- **Built for a busy kitchen:** a shared tablet signs people in with a name tap and a PIN; photos can be taken with the camera or chosen from the gallery; if the AI is asleep, staff can always type the lines.
- **Plain language everywhere:** the activity log reads as sentences, not codes; the dashboard shows four numbers and the newest notification; every product has a step-by-step SOP card; the helper answers questions in plain English or Malay.
- **Each role sees only what it needs:** owner, manager and staff menus differ.

### Feasibility as a Business

- **Measured benefit:** SOPBox records every delivery checked, accepted, rejected, returned and held, the RM value of count gaps and price rises, so an outlet can see what it saved. Malaysian figures and the formulas behind them are in [docs/IMPACT.md](IMPACT.md) (a café buying RM20,000 a month could save RM6,240 to RM14,352 a year). Pilot results: _TBC_.
- **Many SMEs at once:** any business signs up and gets its own isolated workspace on the same deployment, with nothing to install. Chains add outlets, link branches to head office, and connect a till through API keys. The frontend is built on the Orbyte template.
- **Cost to run:** one AI read takes about 2 seconds on a US$0.69/hour GPU, roughly US$0.0004; the first read after the GPU sleeps costs about US$0.035. An idle outlet costs nothing in GPU time.
- **Pricing:** Free for one outlet; Pro per extra outlet (yearly or one-time) with head-office links and API keys; add-ons for customisation and priority support; Enterprise through sales. Prices: _TBC_.
- **Privacy:** each business's data is separated inside the database. Delivery-order photos go only to our own RunPod endpoint running an open-weight model, are not stored, and are not used for training; no third-party AI API sees them. Stock photos stay in that business's workspace for its managers. Keys live in Replit Secrets, never in the code.

### Communication: who answers what in Q&A

| Topic | Answered by |
| ----- | ----------- |
| Business case, pricing, Orbyte | Lye Wei Lun (Team Lead) |
| Rules engine, data and privacy | Leong Zoe Yee (Backend) |
| The app and user experience | Ng Sze Ya (Frontend) |
| The AI model and RunPod | Puteri A'ina Auji Farzana (AI / RunPod) |
| Design and testing | Siow Wei Yik (Design & QA) |

Back to the [README](../README.md).
