import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, ClipboardList, PackageX, Plus, Truck, X } from "lucide-react";
import { api } from "./api";
import type { PageId } from "./App";
import { requestOpen } from "./openTarget";
import { useTeam } from "./Tags";
import type { AssignmentRequest, Job } from "./types";
import { Select } from "./Select";
import { StorageSelect, firstStorageId, useStorages } from "./StorageSelect";
import { ErrorNote, SectionTitle, cardClass, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

const KIND = { po: "Purchase order", delivery: "Held delivery", count: "Stock count" } as const;
const ICON = { po: Truck, delivery: PackageX, count: ClipboardList } as const;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
const OPEN = { po: "Open order", delivery: "Open delivery", count: "Open stock count" } as const;

type Filter = "mine" | "free" | "all";
type Toast = { message: string; undo?: () => Promise<unknown>; open?: Job };

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
};
const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, opts);

/** "Late", "Today", "Tomorrow", a date, or "No date", with the colour that goes with it. */
function urgency(j: Job): { label: string; tone: string; stripe: string } {
  const d = j.days_left;
  if (d === null) return { label: "No date", tone: "bg-slate-100 text-slate-700", stripe: "border-l-slate-300" };
  if (d < 0) return { label: "Late", tone: "bg-red-50 text-red-700", stripe: "border-l-red-500" };
  if (d === 0) return { label: "Today", tone: "bg-amber-50 text-amber-800", stripe: "border-l-amber-500" };
  if (d === 1) return { label: "Tomorrow", tone: "bg-amber-50 text-amber-800", stripe: "border-l-amber-300" };
  return { label: dayLabel(j.due!, { weekday: "short", day: "numeric", month: "short" }), tone: "bg-slate-100 text-slate-700", stripe: "border-l-brand-300" };
}

/**
 * Open orders, held deliveries and planned counts, each with its PIC (person in charge) and the steps
 * to do it. The server works out the jobs and their steps; this page shows them by day and sends who
 * takes what, telling the person what happened each time, with a way to undo it.
 */
const FOLD_KEY = "sopbox-jobs-folded";

export default function Jobs({ day, meId, manager, go }: { day: string; meId: number; manager: boolean; go: (page: PageId) => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [asks, setAsks] = useState<AssignmentRequest[]>([]);
  const [error, setError] = useState("");
  const [planning, setPlanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const team = useTeam();
  const timer = useRef<number>(undefined);
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(FOLD_KEY) === "1";
    } catch {
      return false;
    }
  });
  /** Folded or not is kept on this device, so someone who only uses checklists skips Jobs each time. */
  function fold(next: boolean) {
    setFolded(next);
    try {
      localStorage.setItem(FOLD_KEY, next ? "1" : "0");
    } catch {
      /* storage blocked: only this visit */
    }
  }

  const latest = useRef(0);
  const load = () => {
    const n = ++latest.current; // an older reply arriving late must not undo a newer one
    api.jobs(day).then((js) => n === latest.current && setJobs(js), (e: Error) => setError(e.message));
    if (manager) api.assignmentRequests().then(setAsks, () => setAsks([]));
  };
  useEffect(load, [day, manager]);

  const say = (t: Toast) => {
    window.clearTimeout(timer.current);
    setToast(t);
    timer.current = window.setTimeout(() => setToast(null), 7000);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /** Runs one change, then says what happened. Buttons on that job wait until it is done. */
  const act = async (key: string, fn: () => Promise<Toast | null>) => {
    setError("");
    setBusy(key);
    try {
      const t = await fn();
      if (t) say(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      load();
    }
  };

  const open = (j: Job) => {
    requestOpen(j.kind, j.ref_id);
    go(j.page as PageId);
  };

  const take = (j: Job) =>
    act(`${j.kind}-${j.ref_id}`, async () => {
      const { status } = await api.assign(j.kind, j.ref_id);
      if (status === "requested")
        return { message: `Asked a manager to let you take over ${j.title}. It shows here once they approve.` };
      if (status === "already") return { message: `You are already the PIC of ${j.title}.`, open: j };
      return { message: `You are now the PIC of ${j.title}.`, open: j, undo: () => api.unassign(j.kind, j.ref_id, meId) };
    });

  const assignTo = (j: Job, userId: number) =>
    act(`${j.kind}-${j.ref_id}`, async () => {
      await api.assign(j.kind, j.ref_id, userId);
      const name = team.find((t) => t.id === userId)?.display_name ?? "They";
      return { message: `${name} is now the PIC of ${j.title}.`, undo: () => api.unassign(j.kind, j.ref_id, userId) };
    });

  const remove = (j: Job, userId: number, name: string) =>
    act(`${j.kind}-${j.ref_id}`, async () => {
      await api.unassign(j.kind, j.ref_id, userId);
      const self = userId === meId;
      return {
        message: self ? `You are off ${j.title}.` : `${name} is off ${j.title}.`,
        undo: () => api.assign(j.kind, j.ref_id, self ? undefined : userId),
      };
    });

  const tick = async (j: Job, step: string, done: boolean) => {
    const ticks = done ? [...j.ticks, { step, done_by: "You" }] : j.ticks.filter((t) => t.step !== step);
    setJobs((all) => all?.map((x) => (x === j ? { ...j, ticks } : x)) ?? null); // show it at once
    try {
      await api.tickJob(j.kind, j.ref_id, step, done);
    } catch (e) {
      setError((e as Error).message);
      load();
    }
  };

  const undo = async () => {
    const t = toast;
    setToast(null);
    if (!t?.undo) return;
    await act("undo", async () => {
      await t.undo!();
      return { message: "Undone." };
    });
  };

  const mine = (j: Job) => j.pics.some((p) => p.user_id === meId);
  const counts = { mine: jobs?.filter(mine).length ?? 0, free: jobs?.filter((j) => j.pics.length === 0).length ?? 0, all: jobs?.length ?? 0 };
  const shownFilter: Filter = filter ?? (counts.mine > 0 ? "mine" : "all");
  const inDay = (j: Job) =>
    pickedDay === null ||
    (pickedDay === "late" ? (j.days_left ?? 0) < 0 : pickedDay === "none" ? j.due === null : j.due === pickedDay);
  const shown =
    jobs?.filter((j) => (shownFilter === "mine" ? mine(j) : shownFilter === "free" ? j.pics.length === 0 : true)).filter(inDay) ?? [];

  return (
    <section className="space-y-3" aria-labelledby="jobs-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="jobs-title" className="text-lg font-bold text-brand-950">
          <button type="button" aria-expanded={!folded} className="inline-flex items-center gap-1" onClick={() => fold(!folded)}>
            <ChevronDown aria-hidden className={`h-5 w-5 transition ${folded ? "-rotate-90" : ""}`} />
            Jobs
            {folded && jobs && <span className="ml-1 rounded-full bg-slate-100 px-2 text-sm font-semibold tabular-nums text-slate-600">{counts.mine} mine</span>}
          </button>
        </h2>
        {manager && !planning && !folded && (
          <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700" onClick={() => setPlanning(true)}>
            <Plus aria-hidden className="h-4 w-4" /> Plan a count
          </button>
        )}
      </div>
      {error && <ErrorNote message={error} />}
      {!folded && (
      <>
      {planning && (
        <PlanCount
          team={team}
          onDone={(saved) => {
            setPlanning(false);
            if (saved) say({ message: "Count planned. It shows on its day below." });
            load();
          }}
        />
      )}
      {asks.length > 0 && (
        <ul className={`${cardClass} space-y-3 border-amber-200 bg-amber-50/40`} aria-label="Asking to take over">
          {asks.map((r) => (
            <li key={r.id} className="space-y-2">
              <p className="text-sm text-ink">
                <strong>{r.name}</strong> asks to take over <strong>{r.title}</strong>
                {r.replaces.length > 0 && ` from ${r.replaces.join(", ")}`}.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  className={primaryButton}
                  onClick={() => act(`ask-${r.id}`, async () => (await api.decideAssignment(r.id, true), { message: `${r.name} now runs ${r.title}.` }))}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  className={secondaryButton}
                  onClick={() => act(`ask-${r.id}`, async () => (await api.decideAssignment(r.id, false), { message: `Declined. ${r.title} stays as it was.` }))}
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {jobs && jobs.length > 0 && <Week jobs={jobs} day={day} isMine={mine} picked={pickedDay} onPick={setPickedDay} />}
      {jobs && jobs.length > 0 && (
        <div role="group" aria-label="Show" className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
          {(["mine", "free", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={shownFilter === f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-2 py-2 ${shownFilter === f ? "bg-white text-brand-800 shadow-sm" : "text-muted"}`}
            >
              {{ mine: "Mine", free: "No PIC", all: "All" }[f]} <span className="tabular-nums">{counts[f]}</span>
            </button>
          ))}
        </div>
      )}
      {jobs?.length === 0 && <p className="text-sm text-muted">No open orders, held deliveries or planned counts.</p>}
      {jobs && jobs.length > 0 && shown.length === 0 && (
        <p className="text-sm text-muted">
          Nothing here.{" "}
          <button type="button" className="font-semibold text-brand-700 underline" onClick={() => (setFilter("all"), setPickedDay(null))}>
            Show all jobs
          </button>
        </p>
      )}
      {shown.map((j) => (
        <JobCard
          key={`${j.kind}-${j.ref_id}`}
          job={j}
          meId={meId}
          mine={mine(j)}
          manager={manager}
          busy={busy === `${j.kind}-${j.ref_id}`}
          team={team}
          onTake={() => take(j)}
          onAssign={(id) => assignTo(j, id)}
          onRemove={(id, name) => remove(j, id, name)}
          onTick={(step, done) => tick(j, step, done)}
          onOpen={() => open(j)}
        />
      ))}
      </>
      )}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-20 z-30 flex justify-center lg:bottom-6">
        {toast && (
          <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl bg-brand-950 px-4 py-3 text-sm text-white shadow-lg">
            <p className="min-w-0 flex-1">{toast.message}</p>
            {toast.open && (
              <button type="button" className="shrink-0 font-semibold text-brand-200 underline" onClick={() => (setToast(null), open(toast.open!))}>
                Open
              </button>
            )}
            {toast.undo && (
              <button type="button" className="shrink-0 font-semibold text-brand-200 underline" onClick={undo}>
                Undo
              </button>
            )}
            <button type="button" aria-label="Close" className="shrink-0 text-white/70" onClick={() => setToast(null)}>
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The next seven days, with how many jobs fall on each and how many are yours. Tap a day to see only it. */
function Week({ jobs, day, isMine, picked, onPick }: { jobs: Job[]; day: string; isMine: (j: Job) => boolean; picked: string | null; onPick: (d: string | null) => void }) {
  const late = jobs.filter((j) => (j.days_left ?? 0) < 0);
  const undated = jobs.filter((j) => j.due === null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(day, i));
  const cells = [
    ...(late.length ? [{ id: "late", top: "Late", bottom: "!", list: late }] : []),
    ...days.map((d, i) => ({
      id: d,
      top: i === 0 ? "Today" : dayLabel(d, { weekday: "narrow" }),
      bottom: dayLabel(d, { day: "numeric" }),
      list: jobs.filter((j) => j.due === d),
    })),
    ...(undated.length ? [{ id: "none", top: "No date", bottom: "–", list: undated }] : []),
  ];
  const most = Math.max(1, ...cells.map((c) => c.list.length));
  return (
    <div className={`${cardClass} !p-3`}>
      <div className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Jobs by day">
        {cells.map((c) => {
          const mineCount = c.list.filter(isMine).length;
          const on = picked === c.id;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              aria-label={`${c.top} ${c.bottom}: ${c.list.length} job${c.list.length === 1 ? "" : "s"}, ${mineCount} yours`}
              onClick={() => onPick(on ? null : c.id)}
              className={`flex min-w-9 flex-1 flex-col items-center gap-1 rounded-xl px-0.5 py-2 text-xs ${on ? "bg-brand-50 ring-2 ring-brand-600" : "hover:bg-slate-50"}`}
            >
              <span className={`whitespace-nowrap font-semibold ${c.id === "late" ? "text-red-700" : "text-muted"}`}>{c.top}</span>
              <span className="text-[10px] text-muted">{c.bottom}</span>
              <span className="flex h-10 w-4 flex-col-reverse overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <span className="bg-brand-600" style={{ height: `${(mineCount / most) * 100}%` }} />
                <span className={c.id === "late" ? "bg-red-300" : "bg-brand-200"} style={{ height: `${((c.list.length - mineCount) / most) * 100}%` }} />
              </span>
              <span className="font-bold tabular-nums text-ink">{c.list.length}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex items-center gap-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden /> Yours
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-brand-200" aria-hidden /> Others
        </span>
        {picked && (
          <button type="button" className="ml-auto font-semibold text-brand-700 underline" onClick={() => onPick(null)}>
            All days
          </button>
        )}
      </p>
    </div>
  );
}

function JobCard({
  job: j,
  meId,
  mine,
  manager,
  busy,
  team,
  onTake,
  onAssign,
  onRemove,
  onTick,
  onOpen,
}: {
  job: Job;
  meId: number;
  mine: boolean;
  manager: boolean;
  busy: boolean;
  team: { id: number; display_name: string }[];
  onTake: () => void;
  onAssign: (userId: number) => void;
  onRemove: (userId: number, name: string) => void;
  onTick: (step: string, done: boolean) => void;
  onOpen: () => void;
}) {
  const u = urgency(j);
  const Icon = ICON[j.kind];
  const done = new Map(j.ticks.map((t) => [t.step, t.done_by]));
  // Steps start open on the jobs that need doing soon by this person.
  const soon = mine && j.days_left !== null && j.days_left <= 1;
  const [shown, setShown] = useState(soon);
  useEffect(() => {
    if (soon) setShown(true); // just taken: show what to do
  }, [soon]);
  return (
    <article aria-busy={busy} className={`${cardClass} space-y-3 border-l-4 ${u.stripe} ${busy ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${mine ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700"}`} aria-hidden>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
            <span className={`rounded-full px-2 py-0.5 ${u.tone}`}>{u.label}</span>
            <span className="text-muted">{KIND[j.kind]}</span>
            {j.big && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">Big: 2 PICs</span>}
          </div>
          <h3 className="mt-1 font-semibold leading-snug text-ink">{j.title}</h3>
          <p className={`text-sm ${(j.days_left ?? 0) < 0 ? "font-semibold text-red-700" : "text-muted"}`}>{j.when}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-muted">PIC</span>
        {j.pics.length === 0 && <span className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-muted">Nobody yet</span>}
        {j.pics.map((p) => (
          <span key={p.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pl-0.5 pr-1 text-brand-800">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white" aria-hidden>
              {initials(p.name)}
            </span>
            {p.user_id === meId ? "You" : p.name}
            {(manager || p.user_id === meId) && (
              <button
                type="button"
                disabled={busy}
                aria-label={p.user_id === meId ? `Take yourself off ${j.title}` : `Take ${p.name} off ${j.title}`}
                className="grid h-6 w-6 place-items-center rounded-full hover:bg-brand-100"
                onClick={() => onRemove(p.user_id, p.name)}
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        ))}
      </div>

      {j.steps.length > 0 && (
        <div className="rounded-xl bg-slate-50 p-2">
          <button type="button" aria-expanded={shown} onClick={() => setShown(!shown)} className="flex w-full items-center gap-2 px-1 text-left text-sm">
            <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-muted transition ${shown ? "" : "-rotate-90"}`} />
            <span className="font-semibold text-ink">Steps</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200" aria-hidden>
              <span className="block h-full bg-brand-600 transition-all" style={{ width: `${(done.size / j.steps.length) * 100}%` }} />
            </span>
            <span className="tabular-nums text-muted">
              {done.size} of {j.steps.length}
            </span>
          </button>
          {shown && (
            <ul className="mt-1">
              {j.steps.map((step) => {
                const by = done.get(step);
                return (
                  <li key={step}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-1 py-2 hover:bg-white">
                      <input type="checkbox" checked={by !== undefined} onChange={(e) => onTick(step, e.target.checked)} className="peer sr-only" />
                      <span
                        aria-hidden
                        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600 ${
                          by !== undefined ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-slate-300"
                        }`}
                      >
                        {by !== undefined && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 text-sm">
                        <span className={by !== undefined ? "text-muted line-through" : "text-ink"}>{step}</span>
                        {by !== undefined && <span className="block text-xs text-muted">{by}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!mine && !j.asked && (
          <button type="button" disabled={busy} className={j.can_take ? primaryButton : secondaryButton} onClick={onTake}>
            {busy ? "Saving…" : j.can_take ? "Take it" : "Ask to take over"}
          </button>
        )}
        {j.asked && <span className="self-center text-sm text-muted">Waiting for a manager to approve.</span>}
        <button type="button" className={mine ? primaryButton : secondaryButton} onClick={onOpen}>
          {OPEN[j.kind]} <ArrowRight aria-hidden className="h-4 w-4" />
        </button>
        {manager && (
          <Select
            aria-label={`Assign ${j.title}`}
            value=""
            className="min-w-0 flex-1 basis-40"
            onChange={(v) => v && onAssign(Number(v))}
            choices={[
              { value: "", label: "Assign to…" },
              ...team.filter((t) => !j.pics.some((p) => p.user_id === t.id)).map((t) => ({ value: String(t.id), label: t.display_name })),
            ]}
          />
        )}
      </div>
    </article>
  );
}

function PlanCount({ team, onDone }: { team: { id: number; display_name: string }[]; onDone: (saved: boolean) => void }) {
  const storages = useStorages();
  const [storage, setStorage] = useState<number | null>(null);
  const [due, setDue] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [who, setWho] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const storageId = storage ?? firstStorageId(storages);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (storageId === null) return;
    setSaving(true);
    try {
      await api.planCount(storageId, due, who ? Number(who) : undefined);
      onDone(true);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className={`${cardClass} space-y-3`}>
      <SectionTitle>Plan a stock count</SectionTitle>
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
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving ? "Saving…" : "Plan count"}
        </button>
        <button type="button" className={secondaryButton} onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
