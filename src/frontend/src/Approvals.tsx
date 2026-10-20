import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./api";
import DeliveryLines from "./DeliveryLines";
import type { AuditEntry, Decision, Delivery } from "./types";
import { ErrorNote, StatusBadge, cardClass, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

function PendingCard({
  delivery,
  pin,
  name,
  onDone,
}: {
  delivery: Delivery;
  pin: string;
  name: string;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(decision: Decision) {
    if (!pin) return setError("Enter the manager PIN above.");
    if (!name.trim()) return setError("Enter your name above.");
    if (decision !== "accept" && !reason.trim()) return setError("Give a reason to reject or return.");
    setBusy(true);
    setError("");
    try {
      await api.decide(delivery.id, { decision, decided_by: name.trim(), reason: reason.trim() }, pin);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "Wrong manager PIN." : (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <article className={`${cardClass} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          Delivery #{delivery.id} {delivery.supplier && `from ${delivery.supplier}`}
        </h3>
        <StatusBadge status={delivery.status} />
      </div>
      <p className="text-sm text-slate-600">
        Received by {delivery.received_by} at {new Date(delivery.created_at).toLocaleString()}
      </p>
      <DeliveryLines lines={delivery.lines} />
      <div>
        <label className={labelClass} htmlFor={`reason-${delivery.id}`}>
          Reason (needed to reject or return)
        </label>
        <input id={`reason-${delivery.id}`} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <ErrorNote message={error} />
      <div className="flex flex-wrap gap-2">
        <button className={primaryButton} disabled={busy} onClick={() => void decide("accept")}>
          Accept
        </button>
        <button className={secondaryButton} disabled={busy} onClick={() => void decide("return")}>
          Return to supplier
        </button>
        <button className={secondaryButton} disabled={busy} onClick={() => void decide("reject")}>
          Reject
        </button>
      </div>
    </article>
  );
}

export default function Approvals() {
  const [pending, setPending] = useState<Delivery[]>([]);
  const [activity, setActivity] = useState<AuditEntry[]>([]);
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([api.deliveries("pending_approval"), api.audit(10)]);
      setPending(p);
      setActivity(a);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <section className={`${cardClass} grid gap-3 sm:grid-cols-2`}>
        <div>
          <label className={labelClass} htmlFor="manager-name">
            Your name
          </label>
          <input id="manager-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="manager-pin">
            Manager PIN
          </label>
          <input id="manager-pin" type="password" autoComplete="off" className={inputClass} value={pin} onChange={(e) => setPin(e.target.value)} />
        </div>
      </section>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Waiting for a decision</h2>
        <button className={secondaryButton} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <ErrorNote message={error} />
      {loading && <p className="text-sm text-slate-600">Loading…</p>}
      {!loading && !error && pending.length === 0 && (
        <p className="text-sm text-slate-600">Nothing is waiting. Every delivery has been decided.</p>
      )}
      {pending.map((d) => (
        <PendingCard key={d.id} delivery={d} pin={pin} name={name} onDone={() => void load()} />
      ))}

      <section aria-labelledby="activity-heading" className="space-y-2">
        <h2 id="activity-heading" className="text-lg font-semibold">
          Recent activity
        </h2>
        <ul className={`${cardClass} divide-y divide-slate-100 text-sm`}>
          {activity.length === 0 && <li className="py-1 text-slate-600">No activity yet.</li>}
          {activity.map((a) => (
            <li key={a.id} className="py-1.5">
              <span className="text-slate-500">{new Date(a.at).toLocaleString()}</span> · {a.actor} ·{" "}
              <span className="font-medium">{a.action}</span>
              {a.delivery_id !== null && ` · delivery #${a.delivery_id}`}
              {a.detail && <span className="text-slate-600"> · {a.detail}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
