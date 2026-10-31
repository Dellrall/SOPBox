import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Trash2 } from "lucide-react";
import { api } from "./api";
import { PrintButton } from "./Print";
import { Select } from "./Select";
import type { Disposal, DisposalMethod, Lot, LotStatus } from "./types";
import { Empty, ErrorNote, PageTitle, SectionTitle, SuccessNote, cardClass, dangerButton, inputClass, labelClass, primaryButton, secondaryButton, when } from "./ui";

const METHODS: { value: DisposalMethod; label: string }[] = [
  { value: "food_waste", label: "Food waste bin (compost or biogas)" },
  { value: "donated", label: "Donated (best-before only, still before its date)" },
  { value: "returned", label: "Returned to the supplier" },
  { value: "general_waste", label: "General waste" },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label])) as Record<DisposalMethod, string>;

const BADGE: Record<LotStatus, string> = {
  expired: "bg-red-50 text-red-700 ring-red-200",
  soon: "bg-amber-50 text-amber-800 ring-amber-200",
  ok: "bg-brand-50 text-brand-800 ring-brand-200",
  no_date: "bg-slate-100 text-slate-700 ring-slate-200",
};

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function badge(lot: Lot) {
  if (lot.status === "no_date") return "No date yet";
  if (lot.status === "expired") return `Expired ${day(lot.expiry_on!)}`;
  if (lot.days_left === 0) return "Expires today";
  return `${lot.days_left} day${lot.days_left === 1 ? "" : "s"} left · ${day(lot.expiry_on!)}`;
}

/** Labels for the boxes: one row per lot, with the code to write or stick on it. */
export const labelsDoc = (lots: Lot[], title = "Lot labels") => ({
  title,
  reference: `${lots.length} lot${lots.length === 1 ? "" : "s"}`,
  details: [
    ["Rule", "Write the lot code and expiry date on each box. New stock goes behind; the earliest date goes in front."],
  ] as [string, string][],
  columns: ["Lot", "Product", "Expiry", "Qty", "Location", "Supplier", "Order"],
  rows: lots.map((l) => [
    l.code,
    l.product,
    l.expiry_on ? day(l.expiry_on) : "Fill in",
    `${l.left} ${l.base_unit}`,
    l.location,
    l.supplier || "–",
    [l.delivery_id ? `DO #${l.delivery_id}` : "", l.purchase_order ?? ""].filter(Boolean).join(", ") || "–",
  ]),
});

/** One lot: what it is, where it is, where it came from, and what can be done with it. */
function LotRow({ lot, canEdit, onChanged }: { lot: Lot; canEdit: boolean; onChanged: (note: string) => void }) {
  const [mode, setMode] = useState<"none" | "date" | "dispose">("none");
  const [date, setDate] = useState(lot.expiry_on ?? "");
  const [qty, setQty] = useState(String(lot.left));
  const [method, setMethod] = useState<DisposalMethod>("food_waste");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, note: string) {
    setError("");
    setBusy(true);
    try {
      await action();
      onChanged(note);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 p-3 sm:p-4" data-testid="lot">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-ink">
            {lot.product} <span className="font-mono text-xs text-muted">{lot.code}</span>
          </p>
          <p className="text-sm text-slate-600">
            {lot.left} {lot.base_unit} at <span className="font-medium text-ink">{lot.location}</span>
          </p>
          <p className="text-xs text-muted">
            {[lot.supplier, lot.delivery_id ? `DO #${lot.delivery_id}` : null, lot.purchase_order, `received ${when(lot.received_at)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${BADGE[lot.status]}`}>{badge(lot)}</span>
      </div>
      {canEdit && mode === "none" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} onClick={() => setMode("date")}>
            <CalendarClock aria-hidden className="h-4 w-4" /> {lot.expiry_on ? "Change date" : "Add expiry date"}
          </button>
          <button type="button" className={lot.status === "expired" ? dangerButton : secondaryButton} onClick={() => setMode("dispose")}>
            <Trash2 aria-hidden className="h-4 w-4" /> Dispose
          </button>
        </div>
      )}
      {mode === "date" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.setLotExpiry(lot.id, date), `Expiry date saved for ${lot.code}.`);
          }}
        >
          <div>
            <label className={labelClass} htmlFor={`lot-exp-${lot.id}`}>
              Expiry date on the pack
            </label>
            <input id={`lot-exp-${lot.id}`} type="date" required className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <button type="submit" className={primaryButton} disabled={busy}>
            Save
          </button>
          <button type="button" className={secondaryButton} onClick={() => setMode("none")}>
            Cancel
          </button>
        </form>
      )}
      {mode === "dispose" && (
        <form
          className="space-y-2 rounded-xl bg-slate-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => api.disposeLot(lot.id, { quantity: Number(qty), method, notes }),
              `${qty} ${lot.base_unit} of ${lot.product} disposed and recorded.`,
            );
          }}
        >
          <p className="text-sm text-slate-700">
            Take it off the shelf first. Keep food waste out of general rubbish; rinse and recycle the packaging. Never donate anything past a
            use-by or expiry date.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor={`lot-qty-${lot.id}`}>
                How many {lot.base_unit}
              </label>
              <input
                id={`lot-qty-${lot.id}`}
                type="number"
                min={1}
                max={lot.left}
                required
                className={inputClass}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`lot-how-${lot.id}`}>
                How
              </label>
              <Select id={`lot-how-${lot.id}`} className={inputClass} value={method} choices={METHODS} onChange={(v) => setMethod(v as DisposalMethod)} />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor={`lot-note-${lot.id}`}>
              Note (optional)
            </label>
            <input id={`lot-note-${lot.id}`} maxLength={300} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={dangerButton} disabled={busy}>
              Dispose and record
            </button>
            <button type="button" className={secondaryButton} onClick={() => setMode("none")}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <ErrorNote message={error} />}
    </li>
  );
}

function LotList({ title, lots, canEdit, onChanged, empty }: { title: string; lots: Lot[]; canEdit: boolean; onChanged: (n: string) => void; empty?: string }) {
  if (!lots.length && !empty) return null;
  return (
    <section className="space-y-2">
      <SectionTitle>
        {title} ({lots.length})
      </SectionTitle>
      {lots.length ? (
        <ul className={`${cardClass} divide-y divide-line !p-0`}>
          {lots.map((l) => (
            <LotRow key={l.id} lot={l} canEdit={canEdit} onChanged={onChanged} />
          ))}
        </ul>
      ) : (
        <Empty>{empty}</Empty>
      )}
    </section>
  );
}

/** Every received batch with an expiry date, by how soon it expires, and what was thrown away. */
export default function Expiry({ canEdit }: { canEdit: boolean }) {
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [disposals, setDisposals] = useState<Disposal[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");

  const load = () =>
    Promise.all([api.lots(), api.disposals()])
      .then(([l, d]) => {
        setLots(l);
        setDisposals(d);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (lots ?? []).filter((l) => !words || `${l.product} ${l.code} ${l.location} ${l.supplier}`.toLowerCase().includes(words));
  }, [lots, q]);
  const by = (s: LotStatus) => shown.filter((l) => l.status === s);
  const changed = (n: string) => {
    setNote(n);
    void load();
  };

  return (
    <div className="space-y-5">
      <PageTitle title="Expiry dates" subtitle="Earliest date first. Use the top ones first.">
        {shown.length > 0 && <PrintButton label="Print labels" doc={() => labelsDoc(shown)} />}
      </PageTitle>
      {error && <ErrorNote message={error} />}
      {note && <SuccessNote>{note}</SuccessNote>}
      {lots === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : lots.length === 0 ? (
        <Empty>
          No dated stock yet. Turn on "Track expiry" for a product in Products & SOP; its next delivery asks for the date on the pack.
        </Empty>
      ) : (
        <>
          <input
            type="search"
            aria-label="Search lots"
            placeholder="Search product, lot code, place or supplier"
            className={inputClass}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <LotList title="Expired: dispose of these" lots={by("expired")} canEdit={canEdit} onChanged={changed} />
          <LotList title="Use first: expiring soon" lots={by("soon")} canEdit={canEdit} onChanged={changed} />
          <LotList title="Date still to fill in" lots={by("no_date")} canEdit={canEdit} onChanged={changed} />
          <LotList title="Good" lots={by("ok")} canEdit={canEdit} onChanged={changed} empty="Nothing else in stock with a date." />
        </>
      )}
      {disposals.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Disposed of</SectionTitle>
          <ul className={`${cardClass} divide-y divide-line !p-0 text-sm`}>
            {disposals.map((d) => (
              <li key={d.id} className="p-3">
                <p className="font-medium text-ink">
                  {d.quantity} {d.base_unit} {d.product} {d.lot_code && <span className="font-mono text-xs text-muted">{d.lot_code}</span>}
                </p>
                <p className="text-xs text-muted">
                  {[d.location, METHOD_LABEL[d.method], d.value_sen !== null ? `RM${(d.value_sen / 100).toFixed(2)}` : null, `${d.disposed_by}, ${when(d.created_at)}`, d.notes]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <div className="mt-2">
                  <PrintButton
                    doc={() => ({
                      title: "Disposal record",
                      reference: `Disposal #${d.id}`,
                      badges: [METHOD_LABEL[d.method]],
                      details: [
                        ["Product", d.product],
                        ["Lot", d.lot_code ?? ""],
                        ["Storage area", d.location],
                        ...(d.value_sen !== null ? [["Value lost", `RM${(d.value_sen / 100).toFixed(2)}`] as [string, string]] : []),
                      ],
                      columns: ["Product", "Lot", "Quantity", "How"],
                      rows: [[d.product, d.lot_code ?? "", `${d.quantity} ${d.base_unit}`, METHOD_LABEL[d.method]]],
                      notes: d.notes,
                      history: `Disposed of by ${d.disposed_by} on ${when(d.created_at)}`,
                      sign: ["Disposed by", "Witnessed by"],
                    })}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
