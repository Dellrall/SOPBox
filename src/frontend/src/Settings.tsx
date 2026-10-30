import { useEffect, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import {
  Building2,
  Copy,
  CreditCard,
  Database,
  LifeBuoy,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { api } from "./api";
import { ApiKeys } from "./ApiKeys";
import { ExportCard, PlanCard, SupportCard } from "./Billing";
import { CloseBusiness } from "./Closing";
import { SecurityPolicy, TwoStep } from "./Mfa";
import { HqLinks, Outlets } from "./Places";
import { KitchenTablets, SignInSecurity } from "./Security";
import { setStocktakeStartsExpanded, stocktakeStartsExpanded } from "./Stocktake";
import type { Me, WorkspaceSettings } from "./types";
import { USERNAME_HINT, USERNAME_PATTERN, UsernameStatus, cleanUsername, usernameProblem, useUsernameCheck } from "./username";
import {
  ErrorNote,
  PageTitle,
  roleLabel,
  SectionTitle,
  SuccessNote,
  cardClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./ui";

/** A fixed id, like Discord's: names change, this never does. */
function IdLine({ label, id }: { label: string; id: number | string }) {
  return (
    <p className="flex items-center gap-1 text-xs text-muted">
      {label} <code className="font-mono text-ink">{id}</code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        className="rounded p-1 hover:bg-brand-50"
        onClick={() => void navigator.clipboard?.writeText(String(id))}
      >
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
          {roleLabel(me)} at {me.workspace.name}
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
          <input
            id="me-name"
            required
            maxLength={80}
            autoComplete="name"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="me-email">
            Email
          </label>
          <input
            id="me-email"
            type="email"
            maxLength={254}
            autoComplete="email"
            autoCapitalize="none"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
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
        <input
          id="pw-current"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="pw-new">
          New password
        </label>
        <input
          id="pw-new"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
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
        <SectionTitle>Name and alerts</SectionTitle>
        <IdLine label="Workspace ID" id={ws.public_id} />
      </div>
      <div>
        <label className={labelClass} htmlFor="ws-name">
          Business name
        </label>
        <input
          id="ws-name"
          required
          maxLength={80}
          className={inputClass}
          value={ws.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="ws-tg-manager">
            Telegram chat for managers
          </label>
          <input
            id="ws-tg-manager"
            className={inputClass}
            placeholder="For example -1001234567890"
            value={ws.telegram_manager_chat_id}
            onChange={(e) => set({ telegram_manager_chat_id: e.target.value.trim() })}
          />
          <p className="mt-1 text-xs text-slate-600">Gets an alert when a delivery fails a check.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="ws-tg-staff">
            Telegram chat for staff
          </label>
          <input
            id="ws-tg-staff"
            className={inputClass}
            value={ws.telegram_staff_chat_id}
            onChange={(e) => set({ telegram_staff_chat_id: e.target.value.trim() })}
          />
          <p className="mt-1 text-xs text-slate-600">Gets the manager&apos;s decision.</p>
        </div>
      </div>
      <p className="text-xs text-slate-600">Add the SopBox bot to each chat, then paste the chat id. Leave empty to turn alerts off.</p>
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
          A group only your own people can join. When someone connects Telegram, the bot sends them the link, and it lets them in only while
          their account is active. Remove or let people back in from the Team page.
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

type TabId = "profile" | "security" | "preferences" | "workspace" | "integrations" | "billing" | "data" | "help";
type Tab = { id: TabId; label: string; icon: LucideIcon; blurb: string; show: boolean; body: ReactNode };

/** Where to open: the tab in the address (#billing), or Security after connecting Google or Telegram. */
function startTab(): string {
  const { hash, search } = window.location;
  if (hash.includes("tgAuthResult") || /[?&](linked|auth_error)=/.test(search)) return "security";
  return hash.slice(1);
}

export default function Settings({ me, onMeChanged }: { me: Me; onMeChanged: (me: Me) => void }) {
  const owner = me.role === "owner";
  const manager = me.role !== "staff";
  const refresh = () => void api.session().then((m) => m && onMeChanged(m));
  const tabs: Tab[] = (
    [
      {
        id: "profile",
        label: "Profile",
        icon: UserRound,
        blurb: "Your name, username, email and password.",
        show: true,
        body: (
          <>
            <Profile me={me} onChanged={onMeChanged} />
            <Password />
          </>
        ),
      },
      {
        id: "security",
        label: "Security",
        icon: ShieldCheck,
        blurb: "Two-step sign-in, passkeys, Google and Telegram, and your recent sign-ins.",
        show: true,
        body: (
          <>
            <TwoStep me={me} onChanged={refresh} />
            <SignInSecurity />
            {owner && <SecurityPolicy />}
          </>
        ),
      },
      {
        id: "preferences",
        label: "Preferences",
        icon: SlidersHorizontal,
        blurb: "How pages look and behave on this device.",
        show: true,
        body: <Display />,
      },
      {
        id: "workspace",
        label: "Workspace",
        icon: Building2,
        blurb: "The business's name, outlets, branches, and kitchen tablets.",
        show: manager,
        body: (
          <>
            {owner && <Workspace />}
            <Outlets />
            {owner && <HqLinks />}
            <KitchenTablets />
          </>
        ),
      },
      {
        id: "integrations",
        label: "Integrations",
        icon: Plug,
        blurb: "Connect your till and your team's Telegram group.",
        show: manager,
        body: (
          <>
            <ApiKeys />
            {owner && <TeamGroup />}
          </>
        ),
      },
      {
        id: "billing",
        label: "Plan & billing",
        icon: CreditCard,
        blurb: "Your plan, what it includes, and upgrades.",
        show: manager,
        body: <PlanCard owner={owner} />,
      },
      {
        id: "data",
        label: "Data & privacy",
        icon: Database,
        blurb: "Download a copy of your data" + (owner ? ", or close the business." : "."),
        show: me.can_export || owner,
        body: (
          <>
            {me.can_export && <ExportCard />}
            {owner && <CloseBusiness me={me} onChanged={refresh} />}
            <p className="text-sm text-muted">
              How SOPBox handles personal data:{" "}
              <a href="/privacy" className="font-semibold text-brand-700 underline">
                privacy notice
              </a>
              .
            </p>
          </>
        ),
      },
      {
        id: "help",
        label: "Help",
        icon: LifeBuoy,
        blurb: "Ask the SOPBox team for help.",
        show: true,
        body: <SupportCard />,
      },
    ] satisfies Tab[]
  ).filter((t) => t.show);

  const [tab, setTab] = useState<TabId>(() => tabs.find((t) => t.id === startTab())?.id ?? "profile");
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;
  const choose = (id: TabId) => {
    setTab(id);
    // In the address, so a refresh or a shared link opens the same tab.
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${id}`);
  };
  // On a phone the tabs scroll sideways: keep the chosen one in view.
  useEffect(() => {
    document.getElementById(`settings-tab-${current.id}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current.id]);
  // Arrow keys move between tabs, as screen-reader users expect of a tab list.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = tabs[(tabs.indexOf(current) + step + tabs.length) % tabs.length]!;
    choose(next.id);
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  };

  return (
    <div className="space-y-5">
      <PageTitle title="Settings" />
      <div className="grid gap-5 md:grid-cols-[11.5rem_1fr] xl:grid-cols-[14rem_1fr] md:items-start">
        <div
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
          onKeyDown={onKey}
          className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:sticky md:top-6 md:mx-0 md:flex-col md:gap-1 md:overflow-visible md:rounded-2xl md:bg-white md:p-2 md:ring-1 md:ring-line"
        >
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = t.id === current.id;
            return (
              <button
                key={t.id}
                id={`settings-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="settings-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => choose(t.id)}
                className={`flex shrink-0 snap-start items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                  on
                    ? "bg-brand-600 text-white shadow-sm md:bg-brand-50 md:text-brand-800 md:shadow-none"
                    : "bg-white text-slate-700 ring-1 ring-line hover:bg-brand-50 md:bg-transparent md:ring-0"
                }`}
              >
                <Icon aria-hidden className={`h-4 w-4 ${on ? "md:text-brand-600" : "text-muted"}`} />
                {t.label}
              </button>
            );
          })}
        </div>
        <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${current.id}`} className="min-w-0 space-y-5">
          {/* On a phone the chosen tab already names the section. */}
          <div className="hidden md:block">
            <h2 className="text-xl font-bold text-ink">{current.label}</h2>
            <p className="mt-1 text-sm text-muted">{current.blurb}</p>
          </div>
          {current.body}
        </div>
      </div>
    </div>
  );
}
