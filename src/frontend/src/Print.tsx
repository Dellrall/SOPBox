import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { secondaryButton } from "./ui";

/** One record laid out for paper or PDF: a header, its details, a table of lines and space to sign. */
export type PrintDoc = {
  title: string; // e.g. "Purchase order"
  reference: string; // e.g. "PO-000012"
  details: [string, string][];
  columns: string[];
  rows: (string | number)[][];
  notes?: string;
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
    <div id="print-doc" className="hidden bg-white p-8 text-[12px] leading-snug text-black print:block">
      <header className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider">{business}</p>
          <h1 className="text-2xl font-bold">{doc.title}</h1>
        </div>
        <p className="text-right text-lg font-bold">{doc.reference}</p>
      </header>
      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1">
        {doc.details.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-32 shrink-0 font-semibold">{k}</dt>
            <dd>{v || "–"}</dd>
          </div>
        ))}
      </dl>
      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr>
            <th className="border border-black px-2 py-1 text-left">#</th>
            {doc.columns.map((c) => (
              <th key={c} className="border border-black px-2 py-1 text-left">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doc.rows.map((r, i) => (
            <tr key={i} className="break-inside-avoid">
              <td className="border border-black px-2 py-1">{i + 1}</td>
              {r.map((cell, j) => (
                <td key={j} className="border border-black px-2 py-1">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {doc.notes && (
        <p className="mt-4">
          <span className="font-semibold">Notes: </span>
          {doc.notes}
        </p>
      )}
      {doc.sign && (
        <div className="mt-12 grid grid-cols-2 gap-10">
          {doc.sign.map((s) => (
            <div key={s} className="border-t border-black pt-1">
              {s}: name, signature and date
            </div>
          ))}
        </div>
      )}
      <footer className="mt-8 border-t border-black pt-2 text-[10px]">
        Printed from SOPBox by {by} on {stamp(new Date())}. {doc.reference} is kept in SOPBox's activity log.
      </footer>
    </div>,
    document.body,
  );
}
