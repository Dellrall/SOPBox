import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import type { Me, WorkspaceSettings } from "./types";
import { ErrorNote, PageTitle, cardClass, inputClass, labelClass, primaryButton } from "./ui";

function Password() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone(false);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={`${cardClass} space-y-3`}>
      <h2 className="text-lg font-semibold text-brand-900">Change your password</h2>
      <div>
        <label className={labelClass} htmlFor="pw-current">
          Current password
        </label>
        <input id="pw-current" type="password" required autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div>
        <label className={labelClass} htmlFor="pw-new">
          New password
        </label>
        <input id="pw-new" type="password" required minLength={8} autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
        <p className="mt-1 text-xs text-slate-600">At least 8 characters. Other devices are signed out.</p>
      </div>
      <ErrorNote message={error} />
      {done && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">Password changed.</p>}
      <button type="submit" className={primaryButton}>
        Change password
      </button>
    </form>
  );
}

function Workspace() {
  const [ws, setWs] = useState<WorkspaceSettings | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    api
      .workspace()
      .then(setWs)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!ws) return <ErrorNote message={error} />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ws) return;
    setError("");
    setDone(false);
    try {
      const { id: _id, ...body } = ws;
      setWs(await api.updateWorkspace(body));
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const set = (patch: Partial<WorkspaceSettings>) => setWs({ ...ws, ...patch });
  return (
    <form onSubmit={(e) => void submit(e)} className={`${cardClass} space-y-3`}>
      <h2 className="text-lg font-semibold text-brand-900">Workspace</h2>
      <div>
        <label className={labelClass} htmlFor="ws-name">
          Business name
        </label>
        <input id="ws-name" required maxLength={80} className={inputClass} value={ws.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="ws-tg-manager">
            Telegram chat for managers
          </label>
          <input id="ws-tg-manager" className={inputClass} placeholder="For example -1001234567890" value={ws.telegram_manager_chat_id} onChange={(e) => set({ telegram_manager_chat_id: e.target.value.trim() })} />
          <p className="mt-1 text-xs text-slate-600">Gets an alert when a delivery fails a check.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="ws-tg-staff">
            Telegram chat for staff
          </label>
          <input id="ws-tg-staff" className={inputClass} value={ws.telegram_staff_chat_id} onChange={(e) => set({ telegram_staff_chat_id: e.target.value.trim() })} />
          <p className="mt-1 text-xs text-slate-600">Gets the manager&apos;s decision.</p>
        </div>
      </div>
      <p className="text-xs text-slate-600">
        Add the SopBox bot to each chat, then paste the chat id. Leave empty to turn alerts off.
      </p>
      <ErrorNote message={error} />
      {done && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">Saved.</p>}
      <button type="submit" className={primaryButton}>
        Save
      </button>
    </form>
  );
}

export default function Settings({ me }: { me: Me }) {
  return (
    <div className="space-y-4">
      <PageTitle title="Settings" />
      <section className={cardClass}>
        <p className="text-sm text-slate-700">
          Signed in as <strong>{me.display_name}</strong> ({me.username}) at {me.workspace.name}.
        </p>
      </section>
      <Password />
      {me.role === "owner" && <Workspace />}
    </div>
  );
}
