import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, Search, Truck, X } from "lucide-react";
import { api } from "./api";
import DeliveryLines from "./DeliveryLines";
import { CountCalendar, dayTitle, keyOf } from "./StocktakeHistory";
import type { Delivery, DeliveryStatus } from "./types";
import { Empty, ErrorNote, PageTitle, StatusBadge, inputClass, labelClass, panelClass, secondaryButton } from "./ui";

// The API returns at most this many, newest first. Filtering happens here, on what was loaded.
const LOAD = 200;
const PAGE = 20;

const STATUSES: { id: DeliveryStatus | ""; label: string }[] = [
  { id: "", label: "All" },
  { id: "pending_approval", label: "Waiting" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
  { id: "returned", label: "Returned" },
];

const RANGES = [
  { id: "all", label: "Any time", days: null },
  { id: "today", label: "Today", days: 0 },
  { id: "7", label: "Last 7 days", days: 6 },
  { id: "30", label: "Last 30 days", days: 29 },
] as const;
type Range = (typeof RANGES)[number]["id"];

const DOT: Record<DeliveryStatus, string> = {
  accepted: "bg-emerald-600 text-white",
  pending_approval: "bg-amber-500 text-white",
  rejected: "bg-red-600 text-white",
  returned: "bg-red-600 text-white",
};

const dayOf = (iso: string) => {
  const d = new Date(iso);
  return keyOf(d.getFullYear(), d.getMonth(), d.getDate());
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const supplierOf = (d: Delivery) => d.supplier || "Unknown supplier";

/** The filtered deliveries as a spreadsheet: one row per line. */
function downloadCsv(rows: Delivery[]) {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const out = [["Delivery", "Date", "Supplier", "Purchase order", "Status", "Received by", "Product", "Quantity", "Unit", "Temp °C", "Passed", "Problems", "Decided by", "Reason"]];
  for (const d of rows)
    for (const l of d.lines)
      out.push([
        `#${d.id}`, d.created_at, supplierOf(d), d.purchase_order ?? "", d.status, d.received_by,
        l.name, String(l.quantity), l.unit, l.temp_c === null ? "" : String(l.temp_c), l.passed ? "yes" : "no",
        l.issues.join("; "), d.decided_by ?? "", d.decision_reason ?? "",
      ]);
  const blob = new Blob([out.map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `deliveries-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Records() {
  const [all, setAll] = useState<Delivery[] | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<DeliveryStatus | "">("");
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("");
  const [receiver, setReceiver] = useState("");
  const [range, setRange] = useState<Range>("all");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api
      .deliveries(undefined, LOAD)
      .then(setAll)
      .catch((e: Error) => setError(e.message));
  }, []);

  const rows = all ?? [];
  const suppliers = useMemo(() => [...new Set(rows.map(supplierOf))].sort(), [rows]);
  const receivers = useMemo(() => [...new Set(rows.map((d) => d.received_by))].sort(), [rows]);

  // Everything but the status and the calendar day, so the tabs and bubbles show what those would add.
  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    const days = RANGES.find((r) => r.id === range)?.days ?? null;
    const since = days === null ? null : (() => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return keyOf(d.getFullYear(), d.getMonth(), d.getDate());
    })();
    return rows.filter(
      (d) =>
        (!supplier || supplierOf(d) === supplier) &&
        (!receiver || d.received_by === receiver) &&
        (!since || dayOf(d.created_at) >= since) &&
        (!problemsOnly || d.lines.some((l) => !l.passed)) &&
        (!q ||
          [`#${d.id}`, supplierOf(d), d.purchase_order ?? "", d.received_by, d.decision_reason ?? "", ...d.lines.map((l) => l.name)].some((t) =>
            t.toLowerCase().includes(q),
          )),
    );
  }, [rows, query, supplier, receiver, range, problemsOnly]);

  const counts = useMemo(() => {
    const c = new Map<string, number>([["", base.length]]);
    for (const d of base) c.set(d.status, (c.get(d.status) ?? 0) + 1);
    return c;
  }, [base]);
  const byStatus = status ? base.filter((d) => d.status === status) : base;
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of byStatus) m.set(dayOf(d.created_at), (m.get(dayOf(d.created_at)) ?? 0) + 1);
    return m;
  }, [byStatus]);
  const matching = day ? byStatus.filter((d) => dayOf(d.created_at) === day) : byStatus;
  const visible = day ? matching : matching.slice(0, shown);

  const groups: { day: string; items: Delivery[] }[] = [];
  for (const d of visible) {
    const k = dayOf(d.created_at);
    if (groups[groups.length - 1]?.day !== k) groups.push({ day: k, items: [] });
    groups[groups.length - 1].items.push(d);
  }

  const filtered = Boolean(status || query || supplier || receiver || range !== "all" || problemsOnly || day);
  const clear = () => {
    setStatus("");
    setQuery("");
    setSupplier("");
    setReceiver("");
    setRange("all");
    setProblemsOnly(false);
    setDay(null);
  };
  // Any filter change starts the list from the top again.
  useEffect(() => setShown(PAGE), [status, query, supplier, receiver, range, problemsOnly, day]);

  return (
    <div className="space-y-5">
      <PageTitle title="Delivery records" subtitle="Every delivery received, its readings and the outcome.">
        <button type="button" className={secondaryButton} disabled={!matching.length} onClick={() => downloadCsv(matching)}>
          <Download aria-hidden className="h-4 w-4" /> Download CSV
        </button>
      </PageTitle>
      <ErrorNote message={error} />

      <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={status === s.id}
            onClick={() => setStatus(s.id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
              status === s.id ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-line hover:bg-slate-50"
            }`}
          >
            {s.label}
            <span className={`rounded-full px-1.5 text-xs tabular-nums ${status === s.id ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>
              {counts.get(s.id) ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className={`${panelClass} grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4`}>
        <div className="relative sm:col-span-2">
          <label className={labelClass} htmlFor="records-search">
            Search
          </label>
          <Search aria-hidden className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-muted" />
          <input
            id="records-search"
            type="search"
            placeholder="Supplier, PO, #number, product, person…"
            className={`${inputClass} pl-9`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="records-supplier">
            Supplier
          </label>
          <select id="records-supplier" className={inputClass} value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="records-receiver">
            Received by
          </label>
          <select id="records-receiver" className={inputClass} value={receiver} onChange={(e) => setReceiver(e.target.value)}>
            <option value="">Anyone</option>
            {receivers.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
          <div role="group" aria-label="When" className="flex flex-wrap gap-1.5">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={range === r.id}
                onClick={() => setRange(r.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  range === r.id ? "bg-brand-50 text-brand-800 ring-1 ring-brand-300" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
            Only deliveries with problems
          </label>
        </div>
      </div>

      {all === null && !error && <p className="text-sm text-slate-600">Loading…</p>}
      {all?.length === 0 && <Empty>No deliveries yet. They appear here after a receiving check.</Empty>}

      {all && all.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <CountCalendar perDay={perDay} picked={day} onPick={setDay} noun={["delivery", "deliveries"]} />

          <div className="space-y-4">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted" aria-live="polite">
              Showing {matching.length} of {rows.length} {rows.length === 1 ? "delivery" : "deliveries"}
              {day && <span className="rounded-full bg-brand-50 px-3 py-0.5 font-semibold text-brand-800 ring-1 ring-brand-200">{dayTitle(day)}</span>}
              {filtered && (
                <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline" onClick={clear}>
                  <X aria-hidden className="h-3.5 w-3.5" /> Clear filters
                </button>
              )}
            </p>

            {matching.length === 0 && <Empty>No deliveries match these filters.</Empty>}

            {groups.map((g) => (
              <div key={g.day}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{dayTitle(g.day)}</h3>
                <ol className="relative space-y-3 border-l-2 border-brand-100 pl-5">
                  {g.items.map((d) => {
                    const isOpen = open === d.id;
                    const problems = d.lines.filter((l) => !l.passed).length;
                    return (
                      <li key={d.id} className="relative">
                        <span aria-hidden className={`absolute -left-[1.85rem] top-4 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-surface ${DOT[d.status]}`}>
                          <Truck className="h-3.5 w-3.5" />
                        </span>
                        <div className={panelClass}>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => setOpen(isOpen ? null : d.id)}
                            className="flex w-full items-start justify-between gap-3 rounded-2xl p-4 text-left hover:bg-slate-50"
                          >
                            <span className="min-w-0">
                              <span className="block font-semibold text-brand-950">
                                #{d.id} {supplierOf(d)}
                                {d.purchase_order && ` · ${d.purchase_order}`}
                                <span className="ml-2 text-sm font-normal text-muted">{timeOf(d.created_at)}</span>
                              </span>
                              <span className="mt-0.5 block text-sm text-muted">by {d.received_by}</span>
                              <span className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                                  {d.lines.length} {d.lines.length === 1 ? "line" : "lines"}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 ${problems ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
                                  {problems ? `${problems} with problems` : "All checks passed"}
                                </span>
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-2">
                              <StatusBadge status={d.status} />
                              <span className="flex items-center gap-1 text-sm font-semibold text-brand-700">
                                {isOpen ? "Hide" : "Details"}
                                <ChevronDown aria-hidden className={`h-4 w-4 transition ${isOpen ? "rotate-180" : ""}`} />
                              </span>
                            </span>
                          </button>
                          {isOpen && (
                            <div className="space-y-2 border-t border-line p-4">
                              <DeliveryLines lines={d.lines} />
                              {d.decided_by && (
                                <p className="text-sm text-slate-700">
                                  Decided by {d.decided_by}
                                  {d.decided_at && ` on ${new Date(d.decided_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`}
                                  {d.decision_reason && `: ${d.decision_reason}`}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}

            {!day && shown < matching.length && (
              <button type="button" className={`${secondaryButton} w-full`} onClick={() => setShown((n) => n + PAGE)}>
                Show {Math.min(PAGE, matching.length - shown)} more ({matching.length - shown} left)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
