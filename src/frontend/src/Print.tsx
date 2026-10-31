import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { secondaryButton } from "./ui";

/** One record laid out for paper or PDF: a header, its details, a table of lines and space to sign. */
/** A cell: its text, or its text with a small line under it (e.g. "10 pkt" over "= 100 pcs"). */
export type PrintCell = string | number | [string | number, string];
export type PrintDoc = {
  title: string; // e.g. "Purchase order"
  reference: string; // e.g. "PO-000012"
  badges?: string[]; // status pills, e.g. ["Issued", "Nothing received yet"]
  details: [string, string][];
  columns: string[];
  rows: PrintCell[][];
  notes?: string;
  history?: string; // who did what, e.g. "Created by Aina on 24 Oct · issued by Aina on 24 Oct"
  sign?: string[]; // who signs, e.g. ["Received by", "Checked by"]
};

let current: PrintDoc | null = null;
const listeners = new Set<() => void>();
const set = (doc: PrintDoc | null) => {
  current = doc;
  document.body.classList.toggle("printing-doc", doc !== null);
  listeners.forEach((l) => l());
};

/** Lay the record out and open the browser's print dialog, where "Save as PDF" makes the file. */
export function printDoc(doc: PrintDoc) {
  set(doc);
  // After React has drawn the sheet.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

export function PrintButton({ doc, label = "Print / PDF" }: { doc: () => PrintDoc; label?: string }) {
  return (
    <button type="button" className={`${secondaryButton} print:hidden`} onClick={() => printDoc(doc())}>
      <Printer aria-hidden className="h-4 w-4" /> {label}
    </button>
  );
}

const stamp = (d: Date) =>
  d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** Render once, from the shell. Invisible on screen; while printing, it is the only thing on the page. */
export function PrintHost({ business, by }: { business: string; by: string }) {
  const doc = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  useEffect(() => {
    const done = () => set(null);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);
  if (!doc) return null;
  return createPortal(
    <div id="print-doc" className="hidden bg-white px-10 py-8 text-[12px] leading-snug text-ink print:block">
      <header className="flex items-start justify-between gap-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-700">{business}</p>
          <p className="mt-3 text-[13px] font-semibold uppercase tracking-wider text-muted">{doc.title}</p>
          <h1 className="text-3xl font-bold text-brand-950">{doc.reference}</h1>
        </div>
        {doc.badges && doc.badges.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {doc.badges.map((b) => (
              <span key={b} className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[11px] font-semibold text-brand-800">
                {b}
              </span>
            ))}
          </div>
        )}
      </header>
      <dl className="mt-6 grid grid-cols-3 gap-x-8 gap-y-4">
        {doc.details.map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="font-semibold text-ink">{v || "Not set"}</dd>
          </div>
        ))}
      </dl>
      {doc.notes && <p className="mt-5 rounded-lg bg-surface px-4 py-2">{doc.notes}</p>}
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b border-line">
            {doc.columns.map((c) => (
              <th key={c} className="py-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doc.rows.map((r, i) => (
            <tr key={i} className="break-inside-avoid border-b border-line">
              {r.map((cell, j) => (
                <td key={j} className={`py-2.5 pr-3 align-top ${j === 0 ? "font-semibold text-ink" : ""}`}>
                  {Array.isArray(cell) ? (
                    <>
                      {cell[0]}
                      <span className="block text-[10px] text-muted">{cell[1]}</span>
                    </>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {doc.history && <p className="mt-4 text-muted">{doc.history}</p>}
      {doc.sign && (
        <div className="mt-12 grid grid-cols-2 gap-10">
          {doc.sign.map((s) => (
            <div key={s} className="border-t border-ink pt-1 text-muted">
              {s}: name, signature and date
            </div>
          ))}
        </div>
      )}
      <footer className="mt-8 border-t border-line pt-2 text-[10px] text-muted">
        Printed from SOPBox by {by} on {stamp(new Date())}. {doc.reference} is kept in SOPBox's activity log.
      </footer>
    </div>,
    document.body,
  );
}
