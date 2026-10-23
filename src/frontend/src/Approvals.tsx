import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./api";
import DeliveryLines from "./DeliveryLines";
import type { Decision, Delivery } from "./types";
import {
  Empty,
  ErrorNote,
  PageTitle,
  StatusBadge,
  when,
  cardClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./ui";

function PendingCard({ delivery, onDone }: { delivery: Delivery; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(decision: Decision) {
    if (decision !== "accept" && !reason.trim()) return setError("Give a reason to reject or return.");
    setBusy(true);
    setError("");
    try {
      await api.decide(delivery.id, { decision, reason: reason.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? "Someone else already decided this one." : (e as Error).message);
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
        Received by {delivery.received_by} at {when(delivery.created_at)}
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

export default function Approvals({ onChanged }: { onChanged: () => void }) {
  const [pending, setPending] = useState<Delivery[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setPending(await api.deliveries("pending_approval", 100));
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
      <PageTitle title="Approvals" subtitle="Deliveries that failed a check. Stock is only counted once you accept one, and your name is recorded with the decision.">
        <button className={secondaryButton} onClick={() => void load()}>
          Refresh
        </button>
      </PageTitle>
      <ErrorNote message={error} />
      {loading && <p className="text-sm text-slate-600">Loading…</p>}
      {!loading && !error && pending.length === 0 && (
        <Empty>Nothing is waiting. Every delivery has been decided.</Empty>
      )}
      {pending.map((d) => (
        <PendingCard
          key={d.id}
          delivery={d}
          onDone={() => {
            void load();
            onChanged();
          }}
        />
      ))}
    </div>
  );
}
