import { useEffect, useState } from "react";
import { api } from "./api";
import DeliveryLines from "./DeliveryLines";
import type { Delivery, DeliveryStatus } from "./types";
import { Empty, ErrorNote, PageTitle, StatusBadge, cardClass, inputClass, labelClass, when } from "./ui";

export default function Records() {
  const [status, setStatus] = useState<DeliveryStatus | "">("");
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setRows(null);
    api
      .deliveries(status || undefined, 100)
      .then((d) => {
        setRows(d);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, [status]);

  return (
    <div className="space-y-4">
      <PageTitle title="Delivery records">
        <div>
          <label className={`${labelClass} sr-only`} htmlFor="status-filter">
            Show
          </label>
          <select id="status-filter" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as DeliveryStatus | "")}>
            <option value="">All deliveries</option>
            <option value="pending_approval">Waiting for a manager</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="returned">Returned to supplier</option>
          </select>
        </div>
      </PageTitle>
      <ErrorNote message={error} />
      {rows === null && !error && <p className="text-sm text-slate-600">Loading…</p>}
      {rows?.length === 0 && <Empty>No deliveries to show.</Empty>}
      {rows?.map((d) => (
        <details key={d.id} className={cardClass}>
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              #{d.id} {d.supplier || "Unknown supplier"}
              <span className="ml-2 text-sm font-normal text-slate-600">{when(d.created_at)}</span>
            </span>
            <StatusBadge status={d.status} />
          </summary>
          <div className="mt-3 space-y-2">
            <p className="text-sm text-slate-600">Received by {d.received_by}</p>
            <DeliveryLines lines={d.lines} />
            {d.decided_by && (
              <p className="text-sm text-slate-700">
                Decided by {d.decided_by}
                {d.decided_at && ` on ${when(d.decided_at)}`}
                {d.decision_reason && `: ${d.decision_reason}`}
              </p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
