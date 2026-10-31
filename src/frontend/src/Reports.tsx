import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { api } from "./api";
import { PrintButton } from "./Print";
import SearchSelect from "./SearchSelect";
import { Select } from "./Select";
import { useStorages } from "./StorageSelect";
import type { Product, Report, ReportFilter, ReportKind, Supplier } from "./types";
import { Empty, ErrorNote, PageTitle, cardClass, inputClass, labelClass, secondaryButton } from "./ui";

/** What each report answers, in the order people look for them. */
const KINDS: { value: ReportKind; label: string; group: string; about: string; supplier?: boolean; noPeriod?: boolean; noStorage?: boolean }[] = [
  { value: "spend", label: "Spending by supplier", group: "Buying", about: "What you bought from each supplier and what it cost.", supplier: true },
  { value: "deliveries", label: "Deliveries, line by line", group: "Buying", about: "Every delivered line with its price, check result and expiry.", supplier: true },
  { value: "suppliers", label: "Supplier checks", group: "Buying", about: "How often each supplier's deliveries failed a check or were sent back.", supplier: true },
  { value: "orders", label: "Purchase orders", group: "Buying", about: "What was ordered, what arrived and what is still to come.", supplier: true, noStorage: true },
  { value: "sales_by_product", label: "Sales by product", group: "Selling", about: "How much of each product sold, and a day's average." },
  { value: "sales", label: "Sales, line by line", group: "Selling", about: "Every recorded sale, and where more sold than was in stock." },
  { value: "stock", label: "Stock on hand", group: "Stock", about: "What each storage area holds now and what it is worth.", noPeriod: true },
  { value: "movement", label: "Stock movement", group: "Stock", about: "In and out per product: received, sold, moved, disposed, counted." },
  { value: "counts", label: "Stock counts and gaps", group: "Stock", about: "Expected against counted, and what each gap is worth." },
  { value: "waste", label: "Waste and disposals", group: "Stock", about: "What was thrown away or donated, how, and its value." },
  { value: "transfers", label: "Transfers", group: "Stock", about: "Stock moved between storage areas and outlets." },
  { value: "expiry", label: "Expiry dates", group: "Stock", about: "Batches on the shelf by expiry date. The period filters the expiry date.", supplier: true },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PERIODS: { label: string; range: () => [string, string] }[] = [
  { label: "Today", range: () => [iso(new Date()), iso(new Date())] },
  {
    label: "This week",
    range: () => {
      const d = new Date();
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
      return [iso(d), iso(new Date())];
    },
  },
  { label: "This month", range: () => [iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), iso(new Date())] },
  {
    label: "Last month",
    range: () => {
      const now = new Date();
      return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
    },
  },
  { label: "Last 30 days", range: () => [iso(new Date(Date.now() - 29 * 86_400_000)), iso(new Date())] },
  { label: "This year", range: () => [iso(new Date(new Date().getFullYear(), 0, 1)), iso(new Date())] },
  { label: "All time", range: () => ["", ""] },
];

const money = (sen: number) => `RM ${(sen / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function show(value: string | number | null | undefined, kind: Report["columns"][number]["kind"]): string {
  if (value === null || value === undefined || value === "") return kind === "money" ? "-" : "";
  if (kind === "money") return money(Number(value));
  if (kind === "number") return Number(value).toLocaleString();
  return String(value);
}

function csv(report: Report): string {
  const cell = (v: string | number | null | undefined) => {
    const text = v === null || v === undefined ? "" : String(v);
    // A leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = report.columns.map((c) => cell(c.kind === "money" ? `${c.label} (RM)` : c.label)).join(",");
  const body = report.rows.map((r) =>
    report.columns.map((c) => cell(c.kind === "money" && r[c.key] !== null ? (Number(r[c.key]) / 100).toFixed(2) : r[c.key])).join(","),
  );
  return [head, ...body].join("\n");
}

export default function Reports() {
  const [kind, setKind] = useState<ReportKind>("spend");
  const [from, setFrom] = useState(PERIODS[2].range()[0]);
  const [to, setTo] = useState(PERIODS[2].range()[1]);
  const [productId, setProductId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [storageId, setStorageId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const storages = useStorages();
  const about = KINDS.find((k) => k.value === kind)!;

  useEffect(() => {
    api.products().then(setProducts).catch(() => setProducts([]));
    api.suppliers().then(setSuppliers).catch(() => setSuppliers([]));
  }, []);

  const filter: ReportFilter = useMemo(
    () => ({
      date_from: about.noPeriod ? undefined : from || undefined,
      date_to: about.noPeriod ? undefined : to || undefined,
      product_id: productId ? Number(productId) : undefined,
      supplier: about.supplier ? supplier || undefined : undefined,
      storage_id: about.noStorage ? undefined : storageId ? Number(storageId) : undefined,
    }),
    [about, from, to, productId, supplier, storageId],
  );

  useEffect(() => {
    let live = true;
    setError("");
    api
      .report(kind, filter)
      .then((r) => live && setReport(r))
      .catch((e: Error) => live && (setReport(null), setError(e.message)));
    return () => {
      live = false;
    };
  }, [kind, filter]);

  const period = about.noPeriod ? "Now" : from || to ? `${from || "start"} to ${to || "today"}` : "All time";
  const picked = [
    productId && products.find((p) => String(p.id) === productId)?.name,
    about.supplier && supplier,
    !about.noStorage && storageId && storages.find((s) => String(s.id) === storageId)?.label,
  ].filter(Boolean) as string[];

  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob(["﻿" + csv(report)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.kind}-${from || "all"}-${to || "today"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <PageTitle title="Reports" />
      <section className={`${cardClass} space-y-3`}>
        <div>
          <label className={labelClass} htmlFor="report-kind">
            Report
          </label>
          <Select id="report-kind" className={inputClass} value={kind} choices={KINDS} onChange={(v) => setKind(v as ReportKind)} />
          <p className="mt-1 text-sm text-muted">{about.about}</p>
        </div>
        {!about.noPeriod && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
              {PERIODS.map((p) => {
                const [a, b] = p.range();
                const on = a === from && b === to;
                return (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={on}
                    className={`rounded-full border px-3 py-1 text-sm ${on ? "border-brand-600 bg-brand-50 font-semibold text-brand-800" : "border-slate-300 bg-white text-slate-700"}`}
                    onClick={() => {
                      setFrom(a);
                      setTo(b);
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <label className={labelClass} htmlFor="report-from">
                  From
                </label>
                <input id="report-from" type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="min-w-0">
                <label className={labelClass} htmlFor="report-to">
                  To
                </label>
                <input id="report-to" type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="min-w-0">
            <label className={labelClass} htmlFor="report-product">
              Product
            </label>
            <SearchSelect
              id="report-product"
              noun="products"
              placeholder="All products"
              value={productId}
              options={[{ value: "", label: "All products" }, ...products.map((p) => ({ value: String(p.id), label: p.name, codes: p.code ? [p.code] : [] }))]}
              onChange={setProductId}
            />
          </div>
          {about.supplier && (
            <div className="min-w-0">
              <label className={labelClass} htmlFor="report-supplier">
                Supplier
              </label>
              <Select
                id="report-supplier"
                className={inputClass}
                value={supplier}
                choices={[{ value: "", label: "All suppliers" }, ...suppliers.map((s) => ({ value: s.name, label: s.name }))]}
                onChange={setSupplier}
              />
            </div>
          )}
          {!about.noStorage && storages.length > 1 && (
            <div className="min-w-0">
              <label className={labelClass} htmlFor="report-storage">
                Storage area
              </label>
              <Select
                id="report-storage"
                className={inputClass}
                value={storageId}
                choices={[{ value: "", label: "All storage areas" }, ...storages.map((s) => ({ value: String(s.id), label: s.label }))]}
                onChange={setStorageId}
              />
            </div>
          )}
        </div>
      </section>

      {error && <ErrorNote message={error} />}
      {report && (
        <section className={`${cardClass} space-y-3`} data-testid="report">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="font-semibold text-ink">{report.title}</h2>
              <p className="text-sm text-muted">
                {period}
                {picked.length > 0 && ` · ${picked.join(" · ")}`} · {report.rows.length} row{report.rows.length === 1 ? "" : "s"}
              </p>
            </div>
            {report.rows.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={secondaryButton} onClick={download}>
                  <Download aria-hidden className="h-4 w-4" /> CSV
                </button>
                <PrintButton
                  doc={() => ({
                    title: report.title,
                    reference: period,
                    details: picked.map((p) => ["Filter", p] as [string, string]),
                    columns: report.columns.map((c) => c.label),
                    rows: [
                      ...report.rows.map((r) => report.columns.map((c) => show(r[c.key], c.kind))),
                      report.columns.map((c, i) => (c.key in report.totals ? show(report.totals[c.key], c.kind) : i === 0 ? "Total" : "")),
                    ],
                  })}
                />
              </div>
            )}
          </div>
          {Object.keys(report.totals).length > 0 && report.rows.length > 0 && (
            <dl className="flex flex-wrap gap-2 text-sm">
              {report.columns
                .filter((c) => c.key in report.totals)
                .map((c) => (
                  <div key={c.key} className="rounded-lg bg-slate-50 px-3 py-1.5">
                    <dt className="text-xs text-muted">{c.label}</dt>
                    <dd className="font-semibold tabular-nums text-ink">{show(report.totals[c.key], c.kind)}</dd>
                  </div>
                ))}
            </dl>
          )}
          {report.truncated && <p className="text-sm text-amber-800">Only the first 5,000 rows are shown: narrow the period or filters.</p>}
          {report.rows.length === 0 ? (
            <Empty>Nothing in this period. Try a longer period or fewer filters.</Empty>
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs text-muted">
                  <tr>
                    {report.columns.map((c) => (
                      <th key={c.key} scope="col" className={`whitespace-nowrap px-3 py-2 font-semibold ${c.kind === "money" || c.kind === "number" ? "text-right" : ""}`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.rows.map((r, i) => (
                    <tr key={i}>
                      {report.columns.map((c) => (
                        <td
                          key={c.key}
                          className={`px-3 py-1.5 ${c.kind === "money" || c.kind === "number" ? "whitespace-nowrap text-right tabular-nums" : c.kind === "date" ? "whitespace-nowrap" : ""}`}
                        >
                          {show(r[c.key], c.kind)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
