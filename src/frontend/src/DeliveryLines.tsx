import type { DeliveryLine } from "./types";

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
