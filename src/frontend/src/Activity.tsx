import { useEffect, useState } from "react";
import { api } from "./api";
import type { AuditEntry } from "./types";
import { Empty, ErrorNote, PageTitle, cardClass, when } from "./ui";

export default function Activity() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .audit(200)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="space-y-4">
      <PageTitle title="Activity log" />
      <p className="text-sm text-slate-600">Every receiving, decision and account change, newest first.</p>
      <ErrorNote message={error} />
      {rows?.length === 0 && <Empty>No activity yet.</Empty>}
      {rows && rows.length > 0 && (
        <ul className={`${cardClass} divide-y divide-line text-sm`}>
          {rows.map((a) => (
            <li key={a.id} className="py-2">
              <span className="text-slate-500">{when(a.at)}</span> · {a.actor} ·{" "}
              <span className="font-medium">{a.action}</span>
              {a.delivery_id !== null && ` · delivery #${a.delivery_id}`}
              {a.detail && <span className="text-slate-600"> · {a.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
