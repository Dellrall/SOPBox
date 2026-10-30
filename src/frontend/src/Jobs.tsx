import { useEffect, useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import { api } from "./api";
import type { PageId } from "./App";
import { useTeam } from "./Tags";
import type { AssignmentRequest, Job } from "./types";
import { Select } from "./Select";
import { StorageSelect, firstStorageId, useStorages } from "./StorageSelect";
import { ErrorNote, SectionTitle, cardClass, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

/**
 * Open orders, held deliveries and planned counts, each with its PIC (person in charge). The server
 * works out what each needs today; this page only shows it and sends who takes what.
 */
export default function Jobs({ day, meId, manager, go }: { day: string; meId: number; manager: boolean; go: (page: PageId) => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [asks, setAsks] = useState<AssignmentRequest[]>([]);
  const [error, setError] = useState("");
  const [planning, setPlanning] = useState(false);
  const team = useTeam();

  const load = () => {
    api.jobs(day).then(setJobs, (e: Error) => setError(e.message));
    if (manager) api.assignmentRequests().then(setAsks, () => setAsks([]));
  };
  useEffect(load, [day, manager]);

  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>Jobs</SectionTitle>
        {manager && !planning && (
          <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700" onClick={() => setPlanning(true)}>
            <Plus aria-hidden className="h-4 w-4" /> Plan a count
          </button>
        )}
      </div>
      {error && <ErrorNote message={error} />}
      {planning && <PlanCount team={team} onDone={() => { setPlanning(false); load(); }} />}
      {asks.length > 0 && (
        <ul className={`${cardClass} space-y-3`} aria-label="Asking to take over">
          {asks.map((r) => (
            <li key={r.id} className="space-y-2">
              <p className="text-sm text-ink">
                <strong>{r.name}</strong> asks to take over <strong>{r.title}</strong>
                {r.replaces.length > 0 && ` from ${r.replaces.join(", ")}`}.
              </p>
              <div className="flex gap-2">
                <button type="button" className={primaryButton} onClick={() => act(() => api.decideAssignment(r.id, true))}>
                  Approve
                </button>
                <button type="button" className={secondaryButton} onClick={() => act(() => api.decideAssignment(r.id, false))}>
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {jobs?.length === 0 && <p className="text-sm text-muted">No open orders, held deliveries or planned counts.</p>}
      {jobs?.map((j) => {
        const mine = j.pics.some((p) => p.user_id === meId);
        const late = j.days_left !== null && j.days_left < 0;
        return (
          <article key={`${j.kind}-${j.ref_id}`} className={`${cardClass} space-y-2 ${mine ? "ring-2 ring-brand-600/40" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 font-semibold text-ink">{j.title}</p>
              {j.big && <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Big</span>}
            </div>
            <p className={`text-sm ${late ? "font-semibold text-red-700" : "text-muted"}`}>{j.when}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted">PIC:</span>
              {j.pics.length === 0 && <span className="text-muted">nobody yet</span>}
              {j.pics.map((p) => (
                <span key={p.user_id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-brand-800">
                  {p.user_id === meId ? "You" : p.name}
                  {(manager || p.user_id === meId) && (
                    <button type="button" aria-label={`Remove ${p.name}`} onClick={() => act(() => api.unassign(j.kind, j.ref_id, p.user_id))}>
                      <X aria-hidden className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {!mine && !j.asked && (
                <button type="button" className={j.can_take ? primaryButton : secondaryButton} onClick={() => act(() => api.assign(j.kind, j.ref_id))}>
                  {j.can_take ? "Take it" : "Ask to take over"}
                </button>
              )}
              {j.asked && <span className="self-center text-sm text-muted">Waiting for a manager to approve.</span>}
              {manager && (
                <Select
                  aria-label={`Assign ${j.title}`}
                  value=""
                  className="min-w-0 flex-1 basis-40"
                  onChange={(v) => v && act(() => api.assign(j.kind, j.ref_id, Number(v)))}
                  choices={[
                    { value: "", label: "Assign to…" },
                    ...team.filter((t) => !j.pics.some((p) => p.user_id === t.id)).map((t) => ({ value: String(t.id), label: t.display_name })),
                  ]}
                />
              )}
              <button type="button" className={secondaryButton} onClick={() => go(j.page as PageId)}>
                Open <ArrowRight aria-hidden className="h-4 w-4" />
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function PlanCount({ team, onDone }: { team: { id: number; display_name: string }[]; onDone: () => void }) {
  const storages = useStorages();
  const [storage, setStorage] = useState<number | null>(null);
  const [due, setDue] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [who, setWho] = useState("");
  const [error, setError] = useState("");
  const storageId = storage ?? firstStorageId(storages);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (storageId === null) return;
    try {
      await api.planCount(storageId, due, who ? Number(who) : undefined);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={save} className={`${cardClass} space-y-3`}>
      <StorageSelect id="plan-storage" label="Storage area to count" storages={storages} value={storageId} onChange={setStorage} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="plan-due">
            Count on
          </label>
          <input id="plan-due" type="date" required className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="plan-who">
            PIC
          </label>
          <Select
            id="plan-who"
            value={who}
            onChange={setWho}
            choices={[{ value: "", label: "Anyone" }, ...team.map((t) => ({ value: String(t.id), label: t.display_name }))]}
          />
        </div>
      </div>
      {error && <ErrorNote message={error} />}
      <div className="flex gap-2">
        <button type="submit" className={primaryButton}>
          Plan count
        </button>
        <button type="button" className={secondaryButton} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
