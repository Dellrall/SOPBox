import type { PrintDoc } from "./Print";
import type { Delivery, DeliveryLine } from "./types";
import { STATUS_LABEL, when } from "./ui";

/** A delivery order (DO) laid out for Print / PDF: each line, its reading and its result. */
export function deliveryDoc(d: Delivery): PrintDoc {
  const returned = d.lines.filter((l) => l.returned).length;
  const priced = d.lines.filter((l) => l.unit_price_sen !== null && !l.returned);
  const value = priced.reduce((sum, l) => sum + l.quantity * (l.unit_price_sen ?? 0), 0);
  return {
    title: "Delivery order",
    reference: `DO #${d.id}`,
    badges: [STATUS_LABEL(d.status), ...(returned ? [`${returned} returned`] : [])],
    details: [
      ["Supplier", d.supplier],
      ["Received", when(d.created_at)],
      ["Purchase order", d.purchase_order ?? ""],
      ["Received at", d.storage ?? ""],
      ...(priced.length ? [["Value kept", `RM${(value / 100).toFixed(2)}`] as [string, string]] : []),
    ],
    columns: ["Product", "Quantity", "Temperature", "Expiry", "Result"],
    rows: d.lines.map((l) => [
      l.name,
      `${l.quantity} ${l.unit}`,
      l.temp_c === null ? "" : `${l.temp_c} °C`,
      l.expiry_on ?? "",
      l.returned ? "Returned" : l.passed ? "Passed" : ["Needs a manager", l.issues.join("; ")],
    ]),
    notes: d.decision_reason ?? undefined,
    history: [
      `Received by ${d.received_by} on ${when(d.created_at)}`,
      d.decided_by && d.decided_at ? `decided by ${d.decided_by} on ${when(d.decided_at)}` : "",
    ].filter(Boolean).join(" · "),
    sign: ["Received by", "Checked by"],
  };
}

/** The checked lines of a delivery: what arrived, the reading, and why a line failed. */
export default function DeliveryLines({ lines }: { lines: DeliveryLine[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {lines.map((line) => (
        <li key={line.id} className="py-2 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{line.name}</span>
            <span className={line.returned ? "font-medium text-red-800" : line.passed ? "text-emerald-800" : "font-medium text-amber-900"}>
              {line.returned ? "Returned to supplier" : line.passed ? "Passed" : "Needs a manager"}
            </span>
          </div>
          <p className="text-slate-600">
            {line.quantity} {line.unit}
            {line.received_base_qty !== null &&
              line.received_base_qty !== line.quantity &&
              ` (${line.received_base_qty} base units)`}
            {line.temp_c !== null && `, ${line.temp_c} °C`}
            {line.unit_price_sen !== null && `, RM${(line.unit_price_sen / 100).toFixed(2)} per ${line.unit}`}
            {line.expiry_on && `, expires ${new Date(`${line.expiry_on}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`}
            {line.expiry_later && ", expiry date to fill in"}
          </p>
          {line.issues.map((issue) => (
            <p key={issue} className="text-amber-900">
              {issue}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}
