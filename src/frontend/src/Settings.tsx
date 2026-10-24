import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { KitchenTablets, SignInSecurity } from "./Security";
import { setStocktakeStartsExpanded, stocktakeStartsExpanded } from "./Stocktake";
import type { Me, WorkspaceSettings } from "./types";
import { ErrorNote, PageTitle, ROLE_LABEL, SectionTitle, SuccessNote, cardClass, inputClass, labelClass, primaryButton } from "./ui";

function Profile({ me, onChanged }: { me: Me; onChanged: (me: Me) => void }) {
  const [name, setName] = useState(me.display_name);
  const [email, setEmail] = useState(me.email ?? "");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone(false);
    try {
      onChanged(await api.updateProfile({ display_name: name, email: email.trim() }));
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={`${cardClass} space-y-4`}>
      <div>
        <SectionTitle>Your profile</SectionTitle>
        <p className="mt-1 text-sm text-muted">
          {ROLE_LABEL[me.role]} at {me.workspace.name} · username <strong className="text-ink">{me.username}</strong>
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="me-name">
            Name
          </label>
          <input id="me-name" required maxLength={80} autoComplete="name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="me-email">
            Email
          </label>
          <input id="me-email" type="email" maxLength={254} autoComplete="email" autoCapitalize="none" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="mt-1 text-xs text-muted">You can sign in with it instead of your username.</p>
        </div>
      </div>
      <ErrorNote message={error} />
      {done && <SuccessNote>Profile saved.</SuccessNote>}
      <button type="submit" className={primaryButton}>
        Save profile
      </button>
    </form>
  );
}

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
      <SectionTitle>Change your password</SectionTitle>
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
      {done && <SuccessNote>Password changed.</SuccessNote>}
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
      <SectionTitle>Workspace</SectionTitle>
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
      {done && <SuccessNote>Saved.</SuccessNote>}
      <button type="submit" className={primaryButton}>
        Save
      </button>
    </form>
  );
}

/** Choices about how pages look, kept on this device. */
function Display() {
  const [expanded, setExpanded] = useState(stocktakeStartsExpanded);
  return (
    <section className={`${cardClass} space-y-3`}>
      <SectionTitle>Display</SectionTitle>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 accent-brand-700"
          checked={expanded}
          onChange={(e) => {
            setExpanded(e.target.checked);
            setStocktakeStartsExpanded(e.target.checked);
          }}
        />
        <span>
          <span className="font-semibold text-ink">Open every category on Stock counts</span>
          <span className="block text-muted">Off: categories start minimised, and you tap one to count it. Saved on this device.</span>
        </span>
      </label>
    </section>
  );
}

export default function Settings({ me, onMeChanged }: { me: Me; onMeChanged: (me: Me) => void }) {
  return (
    <div className="space-y-5">
      <PageTitle title="Settings" subtitle="Your profile, how you sign in and, for owners, the workspace." />
      <Profile me={me} onChanged={onMeChanged} />
      <SignInSecurity />
      <Display />
      <Password />
      {me.role !== "staff" && <KitchenTablets />}
      {me.role === "owner" && <Workspace />}
    </div>
  );
}
