# QA checklist

Run on the demo phone against the deployed app. Fill in Result (pass / fail) and Bug for every row.

| # | Case | Expected | Result | Bug |
|---|---|---|---|---|
| 1 | Photo a clear order, all temperatures in range | Lines read, delivery accepted, stock goes up | | |
| 2 | Frozen sausage at -5 °C | Line fails with the range in the message; delivery waits for a manager | | |
| 3 | Frozen sausage with no temperature | Line fails as missing temperature | | |
| 4 | 2 bundles of Fries tray, expected 600 pcs | Converted to 500 pcs, quantity mismatch fails | | |
| 5 | Product not in the catalogue | Fails as unrecognised | | |
| 6 | Manager accepts with the right PIN | Accepted, stock updated, audit entry written | | |
| 7 | Manager decision with a wrong or missing PIN | Rejected with 401, nothing changes | | |
| 8 | Reject or return without a reason | Refused | | |
| 9 | Two managers decide the same delivery | The second gets a conflict; stock is added once | | |
| 10 | Blurry or non-order photo | "Could not read the order", staff can type the lines | | |
| 11 | More than 60 photos in an hour | Reads are refused, staff can type the lines | | |
| 12 | Search the SOP box for "bundle" | Matching product cards appear | | |
| 13 | Telegram notifications (if built) | Manager gets the failure; staff get the decision | | |
| 14 | Phone camera, portrait and landscape | Photo is taken and the page does not scroll sideways | | |

## Bug log

| # | Case | What happened | Severity | Owner | Fixed? |
|---|---|---|---|---|---|
