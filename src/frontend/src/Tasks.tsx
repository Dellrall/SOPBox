import { useEffect, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { api } from "./api";
import type { PageId } from "./App";
import Jobs from "./Jobs";
import type { TaskKind, TaskList, TaskListIn, TaskRole } from "./types";
import { Select } from "./Select";
import {
  DeleteIconButton,
  EditIconButton,
  Empty,
  ErrorNote,
  PageTitle,
  SectionTitle,
  cardClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./ui";

/** The phone's own date: lists start fresh at the outlet's midnight, not the server's. */
const today = () => new Date().toLocaleDateString("en-CA");

const ROLE: Record<TaskRole, string> = { everyone: "Everyone", staff: "Staff", manager: "Managers" };

/** Ready-made lists a manager can add in one tap, then change. */
const STARTERS: TaskListIn[] = [
  {
    name: "Opening",
    kind: "daily",
    for_role: "staff",
    steps: ["Wash hands and put on apron", "Check chiller and freezer temperatures", "Turn on fryers and grill", "Check today's deliveries are due"],
  },
  {
    name: "Closing",
    kind: "daily",
    for_role: "staff",
    steps: ["Label and store leftover prep", "Clean fryers and grill", "Take out the rubbish", "Lock the back door"],
  },
  {
    name: "Peak hour",
    kind: "event",
    for_role: "everyone",
    steps: ["Restock sauces and packaging", "Put a runner on the counter", "Clear tables every 10 minutes", "Hold deliveries until after the rush"],
  },
  {
    name: "New starter",
    kind: "event",
    for_role: "manager",
    steps: ["Give them their SOPBox sign-in", "Show the receiving check", "Walk through the chiller and freezer", "Read the SOP cards together"],
  },
];

export default function Tasks({ canEdit, meId, go }: { canEdit: boolean; meId: number; go: (page: PageId) => void }) {
  const [lists, setLists] = useState<TaskList[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<TaskList | "new" | null>(null);
  const [day, setDay] = useState(today);

  const load = () => {
    const d = today();
    setDay(d);
    api.tasks(d).then(setLists, (e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const replace = (list: TaskList) => setLists((all) => all?.map((l) => (l.id === list.id ? list : l)) ?? null);

  async function tick(list: TaskList, step: number, done: boolean) {
    setError("");
    try {
      replace(await api.tickTask(list.id, day, step, done));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addStarter(body: TaskListIn) {
    setError("");
    try {
      const made = await api.createTaskList(body);
      setLists((all) => [...(all ?? []), made]);
    } catch (e) {
      setError((e as Error).message);
      load(); // someone else may have just added it
    }
  }

  async function remove(list: TaskList) {
    if (!window.confirm(`Remove the task list “${list.name}”?`)) return;
    try {
      await api.deleteTaskList(list.id);
      setLists((all) => all?.filter((l) => l.id !== list.id) ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const daily = lists?.filter((l) => l.kind === "daily") ?? [];
  const events = lists?.filter((l) => l.kind === "event") ?? [];
  const missing = STARTERS.filter((s) => !lists?.some((l) => l.name.toLowerCase() === s.name.toLowerCase()));

  return (
    <div className="space-y-5">
      <PageTitle title="Tasks" subtitle="Jobs with who is in charge, daily checklists, and steps for busy times.">
        {canEdit && !editing && (
          <button type="button" className={primaryButton} onClick={() => setEditing("new")}>
            <Plus aria-hidden className="h-4 w-4" /> Add a list
          </button>
        )}
      </PageTitle>
      {error && <ErrorNote message={error} />}
      {editing && (
        <ListForm
          list={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            setLists((all) => (editing === "new" ? [...(all ?? []), saved] : all?.map((l) => (l.id === saved.id ? saved : l)) ?? null));
            setEditing(null);
          }}
        />
      )}
      <Jobs day={day} meId={meId} manager={canEdit} go={go} />
      {lists === null ? null : lists.length === 0 && !canEdit ? (
        <Empty>No task lists yet. Your manager adds them.</Empty>
      ) : (
        <>
          <section className="space-y-3">
            <SectionTitle>Every day</SectionTitle>
            {daily.length === 0 && <p className="text-sm text-muted">No daily lists yet.</p>}
            {daily.map((l) => (
              <ListCard key={l.id} list={l} open onTick={tick} canEdit={canEdit} onEdit={() => setEditing(l)} onDelete={() => remove(l)} />
            ))}
          </section>
          <section className="space-y-3">
            <SectionTitle>Only when needed</SectionTitle>
            {events.length === 0 && <p className="text-sm text-muted">No lists for busy times or new starters yet.</p>}
            {events.map((l) => (
              <ListCard key={l.id} list={l} onTick={tick} canEdit={canEdit} onEdit={() => setEditing(l)} onDelete={() => remove(l)} />
            ))}
          </section>
          {canEdit && missing.length > 0 && (
            <section className={`${cardClass} space-y-3`}>
              <SectionTitle>Start from a ready-made list</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {missing.map((s) => (
                  <button key={s.name} type="button" className={secondaryButton} onClick={() => addStarter(s)}>
                    <Plus aria-hidden className="h-4 w-4" /> {s.name}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ListCard({
  list,
  open = false,
  onTick,
  canEdit,
  onEdit,
  onDelete,
}: {
  list: TaskList;
  open?: boolean;
  onTick: (list: TaskList, step: number, done: boolean) => void;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [shown, setShown] = useState(open);
  const done = new Map(list.ticks.map((t) => [t.step, t.done_by]));
  const all = done.size === list.steps.length;
  return (
    <article className={cardClass}>
      <div className="flex items-start gap-2">
        <button type="button" aria-expanded={shown} onClick={() => setShown(!shown)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-muted transition ${shown ? "" : "-rotate-90"}`} />
          <span className="min-w-0">
            <span className="block font-semibold text-ink">{list.name}</span>
            <span className={`text-xs ${all ? "font-semibold text-brand-700" : "text-muted"}`}>
              {all ? "All done" : `${done.size} of ${list.steps.length} done`} · {ROLE[list.for_role]}
            </span>
          </span>
        </button>
        {canEdit && (
          <div className="flex shrink-0 gap-1">
            <EditIconButton label={`Edit ${list.name}`} onClick={onEdit} />
            <DeleteIconButton label={`Remove ${list.name}`} onClick={onDelete} />
          </div>
        )}
      </div>
      {shown && (
        <ul className="mt-3 space-y-1">
          {list.steps.map((step, i) => {
            const by = done.get(i);
            return (
              <li key={i}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 hover:bg-brand-50">
                  <input type="checkbox" checked={by !== undefined} onChange={(e) => onTick(list, i, e.target.checked)} className="peer sr-only" />
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
    </article>
  );
}

function ListForm({ list, onCancel, onSaved }: { list: TaskList | null; onCancel: () => void; onSaved: (list: TaskList) => void }) {
  const [name, setName] = useState(list?.name ?? "");
  const [kind, setKind] = useState<TaskKind>(list?.kind ?? "daily");
  const [role, setRole] = useState<TaskRole>(list?.for_role ?? "everyone");
  const [steps, setSteps] = useState(list?.steps.join("\n") ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), kind, for_role: role, steps: steps.split("\n").map((s) => s.trim()).filter(Boolean) };
    if (body.steps.length === 0) return setError("Add at least one step.");
    setBusy(true);
    setError("");
    try {
      onSaved(list ? await api.updateTaskList(list.id, body) : await api.createTaskList(body));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className={`${cardClass} space-y-3`}>
      <SectionTitle>{list ? `Edit ${list.name}` : "New task list"}</SectionTitle>
      <div>
        <label className={labelClass} htmlFor="task-name">
          Name
        </label>
        <input id="task-name" required maxLength={80} placeholder="Opening, Closing, Peak hour…" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="task-kind">
            When
          </label>
          <Select
            id="task-kind"
            value={kind}
            onChange={(v) => setKind(v as TaskKind)}
            choices={[
              { value: "daily", label: "Every day" },
              { value: "event", label: "Only when needed (busy day, new starter)" },
            ]}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="task-role">
            For
          </label>
          <Select
            id="task-role"
            value={role}
            onChange={(v) => setRole(v as TaskRole)}
            choices={(Object.keys(ROLE) as TaskRole[]).map((r) => ({ value: r, label: ROLE[r] }))}
          />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="task-steps">
          Steps, one per line
        </label>
        <textarea id="task-steps" rows={6} className={inputClass} value={steps} onChange={(e) => setSteps(e.target.value)} />
      </div>
      {error && <ErrorNote message={error} />}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          Save list
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
