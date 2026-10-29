import { useEffect, useState, type FormEvent } from "react";
import { Copy } from "lucide-react";
import { api } from "./api";
import { ApiKeys } from "./ApiKeys";
import { ExportCard, PlanCard, SupportCard } from "./Billing";
import { SecurityPolicy, TwoStep } from "./Mfa";
import { HqLinks, Outlets } from "./Places";
import { KitchenTablets, SignInSecurity } from "./Security";
import { setStocktakeStartsExpanded, stocktakeStartsExpanded } from "./Stocktake";
import type { Me, WorkspaceSettings } from "./types";
import { USERNAME_HINT, USERNAME_PATTERN, UsernameStatus, cleanUsername, usernameProblem, useUsernameCheck } from "./username";
import { ErrorNote, PageTitle, ROLE_LABEL, SectionTitle, SuccessNote, cardClass, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

/** A fixed id, like Discord's: names change, this never does. */
function IdLine({ label, id }: { label: string; id: number }) {
  return (
    <p className="flex items-center gap-1 text-xs text-muted">
      {label} <code className="font-mono text-ink">{id}</code>
      <button type="button" aria-label={`Copy ${label}`} className="rounded p-1 hover:bg-brand-50" onClick={() => void navigator.clipboard?.writeText(String(id))}>
        <Copy aria-hidden className="h-3.5 w-3.5" />
      </button>
      · never changes
    </p>
  );
}

function Profile({ me, onChanged }: { me: Me; onChanged: (me: Me) => void }) {
  const [username, setUsername] = useState(me.username);
  const usernameCheck = useUsernameCheck(username, username === me.username);
  const [name, setName] = useState(me.display_name);
  const [email, setEmail] = useState(me.email ?? "");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone(false);
    if (usernameProblem(username)) return setError(`Username: ${usernameProblem(username)}`);
    try {
      onChanged(await api.updateProfile({ username, display_name: name, email: email.trim() }));
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
          {ROLE_LABEL[me.role]} at {me.workspace.name}
        </p>
        <IdLine label="User ID" id={me.id} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="me-username">
            Username
          </label>
          <input
            id="me-username"
            required
            minLength={3}
            maxLength={32}
            pattern={USERNAME_PATTERN}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(cleanUsername(e.target.value).value)}
          />
          <UsernameStatus check={usernameCheck} />
          <p className="mt-1 text-xs text-muted">{USERNAME_HINT} You sign in with the new one after saving.</p>
        </div>
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
      const { name, telegram_manager_chat_id, telegram_staff_chat_id } = ws;
      setWs(await api.updateWorkspace({ name, telegram_manager_chat_id, telegram_staff_chat_id }));
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const set = (patch: Partial<WorkspaceSettings>) => setWs({ ...ws, ...patch });
  return (
    <form onSubmit={(e) => void submit(e)} className={`${cardClass} space-y-3`}>
      <div>
        <SectionTitle>Workspace</SectionTitle>
        <IdLine label="Workspace ID" id={ws.id} />
      </div>
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

/**
 * The workspace's Telegram team group. The owner makes the group; SOPBox lets in only the
 * workspace's own people (see team_group.py on the server).
 */
function TeamGroup() {
  const [ws, setWs] = useState<WorkspaceSettings | null>(null);
  const [chatId, setChatId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .workspace()
      .then(setWs)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function run(action: () => Promise<WorkspaceSettings>) {
    setError("");
    setBusy(true);
    try {
      setWs(await action());
      setChatId("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ws) return null;
  return (
    <section className={`${cardClass} space-y-3`}>
      <div>
        <SectionTitle>Telegram team group</SectionTitle>
        <p className="mt-1 text-sm text-muted">
          A group only your own people can join. When someone connects Telegram, the bot sends them the link, and it lets
          them in only while their account is active. Remove or let people back in from the Team page.
        </p>
      </div>
      {ws.telegram_team_chat_id ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-ink">{ws.telegram_team_title || "Team group"}</span>
            <span className="block break-all text-xs text-muted">{ws.telegram_team_invite_link}</span>
          </span>
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => void run(api.disconnectTeamGroup)}>
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>In Telegram, create a group for your team.</li>
            <li>In the group's settings, set "Chat history for new members" to Visible.</li>
            <li>Add the SOPBox bot as an admin with "Invite users via link" and "Ban users" turned on.</li>
            <li>Paste the group's chat id below (it starts with -100).</li>
          </ol>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api.connectTeamGroup(chatId));
            }}
          >
            <label className="sr-only" htmlFor="team-group-chat">
              Group chat id
            </label>
            <input
              id="team-group-chat"
              required
              inputMode="numeric"
              pattern="-?\d{1,20}"
              placeholder="-1001234567890"
              className={`${inputClass} min-w-40 flex-1`}
              value={chatId}
              onChange={(e) => setChatId(e.target.value.trim())}
            />
            <button type="submit" className={primaryButton} disabled={busy}>
              {busy ? "Checking…" : "Connect group"}
            </button>
          </form>
        </>
      )}
      <ErrorNote message={error} />
    </section>
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
      <TwoStep me={me} onChanged={() => void api.session().then((m) => m && onMeChanged(m))} />
      <SignInSecurity />
      <Display />
      <Password />
      {me.role !== "staff" && <KitchenTablets />}
      {me.role === "owner" && <Workspace />}
      {me.role === "owner" && <SecurityPolicy />}
      {me.role === "owner" && <TeamGroup />}
      {me.role !== "staff" && <Outlets />}
      {me.role === "owner" && <HqLinks />}
      {me.role !== "staff" && <ApiKeys />}
      {me.role !== "staff" && <PlanCard owner={me.role === "owner"} />}
      <ExportCard />
      <SupportCard />
    </div>
  );
}
