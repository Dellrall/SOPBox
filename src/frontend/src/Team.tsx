import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { DEFAULT_STAFF_ACCESS, SECTION_ACCESS_AREAS, type Accountability, type Me, type Outlet, type SectionAccess, type UserOut } from "./types";
import { USERNAME_HINT, USERNAME_PATTERN, UsernameStatus, cleanUsername, usernameProblem, useUsernameCheck } from "./username";
import { Empty, ErrorNote, PageTitle, SectionTitle, SuccessNote, cardClass, inputClass, labelClass, primaryButton, roleLabel, secondaryButton } from "./ui";
import { Select } from "./Select";

/** Who is signed in: the owner, an outlet's manager, or its assistant manager. */
type Level = "owner" | "manager" | "assistant";
type Position = "staff" | "assistant" | "manager";

const POSITIONS: { value: Position; label: string }[] = [
  { value: "staff", label: "Staff" },
  { value: "assistant", label: "Assistant manager" },
  { value: "manager", label: "Manager" },
];
/** The owner gives any role; the outlet manager, staff or assistant manager; an assistant, none. */
const positionChoices = (level: Level) => POSITIONS.slice(0, { owner: 3, manager: 2, assistant: 0 }[level]);
const positionOf = (u: UserOut): Position => (u.role === "staff" ? "staff" : u.assistant ? "assistant" : "manager");
const asRole = (p: Position) => (p === "staff" ? { role: "staff" as const } : { role: "manager" as const, assistant: p === "assistant" });

/** The owner ties a person to the outlet they work at; "" is none. */
const outletChoices = (outlets: Outlet[]) => [{ value: "", label: "Not tied to an outlet" }, ...outlets.map((o) => ({ value: String(o.id), label: o.name }))];

function SectionAccessFields({
  value,
  onChange,
}: {
  value: SectionAccess;
  onChange: (value: SectionAccess) => void;
}) {
  return (
    <fieldset className={`${cardClass} space-y-3`}>
      <legend className="px-1 text-sm font-bold text-brand-950">Staff section access</legend>
      <p className="text-sm text-muted">Choose which sections this staff account can open and whether they can make changes.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {SECTION_ACCESS_AREAS.map(({ key, label }) => (
          <div key={key} className="grid gap-1.5 rounded-xl border border-line bg-white px-3 py-2 min-[400px]:grid-cols-[minmax(0,1fr)_minmax(8.5rem,1.8fr)] min-[400px]:items-center min-[400px]:gap-3">
            <label className="text-sm font-medium text-ink" htmlFor={`access-${key}`}>
              {label}
            </label>
            <Select
              id={`access-${key}`}
              className={`${inputClass} w-full`}
              value={value[key]}
              choices={[
                { value: "none", label: "No access" },
                { value: "view", label: "View only" },
                { value: "edit", label: "Edit + add" },
              ]}
              onChange={(v) => onChange({ ...value, [key]: v as SectionAccess[typeof key] })}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function CreateForm({ onCreated, outlets, level }: { onCreated: () => void; outlets: Outlet[]; level: Level }) {
  const choices = positionChoices(level);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const usernameCheck = useUsernameCheck(username);
  const [email, setEmail] = useState("");
  const [dropped, setDropped] = useState(false);
  const [position, setPosition] = useState<Position>("staff");
  const role = position === "staff" ? "staff" : "manager";
  const [outlet, setOutlet] = useState("");
  const [sectionAccess, setSectionAccess] = useState<SectionAccess>({ ...DEFAULT_STAFF_ACCESS });
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone("");
    if (usernameProblem(username)) return setError(`Username: ${usernameProblem(username)}`);
    setBusy(true);
    try {
      const made = await api.createUser({
        username,
        display_name: name,
        ...asRole(position),
        password,
        ...(email.trim() ? { email } : {}),
        ...(role === "staff" ? { section_access: sectionAccess } : {}),
        ...(outlet ? { outlet_id: Number(outlet) } : {}),
      });
      setDone(`Account created. Give ${made.display_name} the username "${made.username}" and the password you just set.`);
      setName("");
      setUsername("");
      setEmail("");
      setPassword("");
      setSectionAccess({ ...DEFAULT_STAFF_ACCESS });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={`${cardClass} space-y-3`}>
      <SectionTitle>{level === "owner" ? "Create an account" : "Add someone to your outlet"}</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="u-name">
            Name
          </label>
          <input id="u-name" required maxLength={80} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="u-username">
            Username
          </label>
          <input
            id="u-username"
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            minLength={3}
            maxLength={32}
            pattern={USERNAME_PATTERN}
            title={USERNAME_HINT}
            aria-describedby="u-username-hint"
            className={inputClass}
            value={username}
            onChange={(e) => {
              const cleaned = cleanUsername(e.target.value);
              setUsername(cleaned.value);
              setDropped(cleaned.removed);
            }}
          />
          <UsernameStatus check={usernameCheck} />
          <p id="u-username-hint" className={`mt-1 text-xs ${dropped ? "font-semibold text-amber-800" : "text-muted"}`} aria-live="polite">
            {dropped ? "Spaces and symbols can't be used, so they were left out. " : ""}
            {USERNAME_HINT}
          </p>
        </div>
        <div>
          <label className={labelClass} htmlFor="u-email">
            Email <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="u-email" type="email" maxLength={254} autoCapitalize="none" autoComplete="off" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="mt-1 text-xs text-muted">They can sign in with it instead of the username.</p>
        </div>
        {choices.length > 1 && (
          <div>
            <label className={labelClass} htmlFor="u-role">
              Role
            </label>
            <Select id="u-role" className={inputClass} value={position} choices={choices} onChange={(v) => setPosition(v as Position)} />
            {position === "assistant" && <p className="mt-1 text-xs text-muted">Adds and looks after staff, but cannot disable anyone.</p>}
          </div>
        )}
        {level === "owner" && outlets.length > 1 && (
          <div>
            <label className={labelClass} htmlFor="u-outlet">
              Works at
            </label>
            <Select id="u-outlet" className={inputClass} value={outlet} choices={outletChoices(outlets)} onChange={setOutlet} />
            <p className="mt-1 text-xs text-muted">The app starts them there, and its managers look after its staff.</p>
          </div>
        )}
        <div>
          <label className={labelClass} htmlFor="u-password">
            Starting password
          </label>
          <input id="u-password" required minLength={8} autoComplete="new-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-xs text-slate-600">At least 8 characters. They can change it under Settings.</p>
        </div>
      </div>
      {role === "staff" && <SectionAccessFields value={sectionAccess} onChange={setSectionAccess} />}
      <ErrorNote message={error} />
      {done && <SuccessNote>{done}</SuccessNote>}
      <button type="submit" disabled={busy} className={primaryButton}>
        Create account
      </button>
    </form>
  );
}

const FOREVER_YEAR = "9999";

/** Team group status and the owner's remove / let back in controls. */
function TeamGroupControls({ user, onChanged }: { user: UserOut; onChanged: () => void }) {
  const [error, setError] = useState("");
  const until = user.team_group_removed_until;
  const removed = until !== null && new Date(until) > new Date();

  async function act(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">
        Team group:{" "}
        {removed
          ? until!.startsWith(FOREVER_YEAR)
            ? "removed until you let them back in"
            : `removed until ${new Date(until!).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
          : user.telegram_linked
            ? "can join"
            : "hasn't connected Telegram yet"}
      </span>
      {removed ? (
        <button className={secondaryButton} onClick={() => void act(() => api.letBackIntoTeamGroup(user.id))}>
          Let back in
        </button>
      ) : (
        <>
          <label className="sr-only" htmlFor={`tg-remove-${user.id}`}>
            Remove {user.display_name} from the team group
          </label>
          <Select
            id={`tg-remove-${user.id}`}
            className={`${inputClass} w-auto!`}
            value=""
            choices={[
              { value: "", label: "Remove from group…" },
              { value: "1", label: "For 1 hour" },
              { value: "24", label: "For 1 day" },
              { value: "168", label: "For 1 week" },
              { value: "forever", label: "Until I let them back in" },
            ]}
            onChange={(v) => {
              if (v) void act(() => api.removeFromTeamGroup(user.id, v === "forever" ? null : (Number(v) as 1 | 24 | 168)));
            }}
          />
        </>
      )}
      <ErrorNote message={error} />
    </div>
  );
}

function Row({
  user,
  onChanged,
  teamGroup,
  outlets,
  level,
}: {
  user: UserOut;
  onChanged: () => void;
  teamGroup: boolean;
  outlets: Outlet[];
  level: Level;
}) {
  const manager = level !== "owner";
  const choices = positionChoices(level);
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const [email, setEmail] = useState(user.email ?? "");
  const [editingAccess, setEditingAccess] = useState(false);
  const [sectionAccess, setSectionAccess] = useState<SectionAccess>(user.section_access);
  const [error, setError] = useState("");
  // The owner looks after everyone but themselves; an outlet's manager, its staff and assistants; an assistant, its staff.
  const editable = user.role !== "owner" && (level === "owner" || (level === "manager" ? positionOf(user) !== "manager" : user.role === "staff"));
  const outletName = outlets.find((o) => o.id === user.outlet_id)?.name;

  async function change(body: Parameters<typeof api.updateUser>[1]) {
    setError("");
    try {
      await api.updateUser(user.id, body);
      setResetting(false);
      setEditingEmail(false);
      setEditingAccess(false);
      setPassword("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">
            {user.display_name}
            {!user.active && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs">Disabled</span>}
          </p>
          <p className="text-sm text-muted">
            {user.username} · {roleLabel(user)}
            {outletName && outlets.length > 1 && <> · {outletName}</>}
            {user.email && <> · {user.email}</>}
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            {choices.length > 1 && (
              <>
                <label className="sr-only" htmlFor={`role-${user.id}`}>
                  Role of {user.display_name}
                </label>
                <Select
                  id={`role-${user.id}`}
                  className={`${inputClass} w-auto!`}
                  value={positionOf(user)}
                  choices={choices}
                  onChange={(v) => void change(asRole(v as Position))}
                />
              </>
            )}
            {!manager && outlets.length > 1 && (
              <>
                <label className="sr-only" htmlFor={`outlet-${user.id}`}>
                  Outlet of {user.display_name}
                </label>
                <Select
                  id={`outlet-${user.id}`}
                  className={`${inputClass} w-auto!`}
                  value={user.outlet_id == null ? "" : String(user.outlet_id)}
                  choices={outletChoices(outlets)}
                  onChange={(v) => void change({ outlet_id: v ? Number(v) : null })}
                />
              </>
            )}
            <button className={secondaryButton} onClick={() => setEditingEmail((r) => !r)}>
              {user.email ? "Change email" : "Add email"}
            </button>
            {user.role === "staff" && (
              <button
                className={secondaryButton}
                onClick={() => {
                  setSectionAccess(user.section_access);
                  setEditingAccess((r) => !r);
                }}
              >
                Section access
              </button>
            )}
            <button className={secondaryButton} onClick={() => setResetting((r) => !r)}>
              Reset password
            </button>
            {!manager && user.mfa_enabled && (
              <button
                className={secondaryButton}
                onClick={() =>
                  window.confirm(`Turn off two-step sign-in for ${user.display_name}? Do this only if they lost their phone and backup codes. They sign in with their password and set it up again.`) &&
                  void change({ mfa_reset: true })
                }
              >
                Reset two-step sign-in
              </button>
            )}
            {level !== "assistant" && (
              <button className={secondaryButton} onClick={() => void change({ active: !user.active })}>
                {user.active ? "Disable" : "Enable"}
              </button>
            )}
          </div>
        )}
      </div>
      {teamGroup && editable && !manager && user.active && <TeamGroupControls user={user} onChanged={onChanged} />}
      {editingAccess && user.role === "staff" && (
        <div className="space-y-2">
          <SectionAccessFields value={sectionAccess} onChange={setSectionAccess} />
          <div className="flex gap-2">
            <button className={primaryButton} onClick={() => void change({ section_access: sectionAccess })}>
              Save access
            </button>
            <button className={secondaryButton} onClick={() => setEditingAccess(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {editingEmail && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void change({ email: email.trim() });
          }}
        >
          <label className="sr-only" htmlFor={`email-${user.id}`}>
            Email for {user.display_name}
          </label>
          <input id={`email-${user.id}`} type="email" maxLength={254} placeholder="name@example.com" className={`${inputClass} sm:w-72`} value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className={primaryButton}>
            Save email
          </button>
          <span className="text-xs text-muted">Leave empty to remove it.</span>
        </form>
      )}
      {resetting && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`pw-${user.id}`}>
            New password for {user.display_name}
          </label>
          <input id={`pw-${user.id}`} minLength={8} autoComplete="new-password" placeholder="New password" className={`${inputClass} sm:w-64`} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className={primaryButton} disabled={password.length < 8} onClick={() => void change({ password })}>
            Set password
          </button>
          <span className="text-xs text-slate-600">They are signed out everywhere.</span>
        </div>
      )}
      <ErrorNote message={error} />
    </li>
  );
}

/** Owner only: create and manage the accounts of the people who work here. */
const COUNTS: { key: keyof Pick<Accountability, "received" | "decided" | "stock_counts" | "purchase_orders" | "comments" | "tagged">; label: string }[] = [
  { key: "received", label: "Deliveries received" },
  { key: "decided", label: "Approvals decided" },
  { key: "stock_counts", label: "Stock counts" },
  { key: "purchase_orders", label: "Order actions" },
  { key: "comments", label: "Comments" },
  { key: "tagged", label: "Tagged on" },
];

/** What each person has done, counted by account from the activity log. */
function AccountabilityTable() {
  const [rows, setRows] = useState<Accountability[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .accountability()
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section aria-labelledby="accountability-title" className="space-y-2">
      <h2 id="accountability-title" className="text-lg font-bold text-brand-950">
        Accountability
      </h2>
      <p className="text-sm text-muted">
        Every action is tied to the account that did it. To see one person's actions, choose them under Person in the Activity log.
      </p>
      <ErrorNote message={error} />
      {rows && (
        <div className={`${cardClass} overflow-x-auto`}>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5">Person</th>
                {COUNTS.map((c) => (
                  <th key={c.key} scope="col" className="px-3 py-2.5 text-right">{c.label}</th>
                ))}
                <th scope="col" className="px-4 py-2.5 text-right">Last active</th>
                <th scope="col" className="px-4 py-2.5 text-right">Last sign-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.user_id} className={r.active ? "" : "text-muted"}>
                  <th scope="row" className="px-4 py-2.5 text-left font-semibold text-ink">
                    {r.display_name}
                    <span className="block text-xs font-normal text-muted">
                      @{r.username} · {r.role}{r.active ? "" : " · inactive"}
                    </span>
                  </th>
                  {COUNTS.map((c) => (
                    <td key={c.key} className="px-3 py-2.5 text-right tabular-nums">{r[c.key]}</td>
                  ))}
                  <td className="px-4 py-2.5 text-right text-xs text-muted">
                    {r.last_active ? new Date(r.last_active).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Never"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted">
                    {r.last_sign_in ? new Date(r.last_sign_in).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Team({ me }: { me: Me }) {
  const level: Level = me.role === "owner" ? "owner" : me.assistant ? "assistant" : "manager";
  const manager = level !== "owner";
  const [users, setUsers] = useState<UserOut[] | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [teamGroup, setTeamGroup] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .outlets()
      .then(setOutlets)
      .catch(() => setOutlets([]));
    if (manager) return;
    api
      .workspace()
      .then((ws) => setTeamGroup(Boolean(ws.telegram_team_chat_id)))
      .catch(() => setTeamGroup(false));
  }, [manager]);

  const load = useCallback(() => {
    api
      .users()
      .then((u) => {
        setUsers(u);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      <PageTitle
        title="Team"
        subtitle={
          manager
            ? `The people at ${outlets.find((o) => o.id === me.outlet_id)?.name ?? "your outlet"}. ${
                level === "assistant"
                  ? "Add staff, choose their section access, reset passwords. The outlet manager disables accounts."
                  : "Add staff and assistant managers, choose section access, reset passwords. The owner makes managers and moves people between outlets."
              }`
            : "Choose section access for staff and the outlet each person works at. An outlet's managers look after its staff."
        }
      />
      <CreateForm onCreated={load} outlets={outlets} level={level} />
      <ErrorNote message={error} />
      {users?.length === 0 && <Empty>No accounts yet.</Empty>}
      {users && (
        <ul className={`${cardClass} divide-y divide-line`}>
          {users.map((u) => (
            <Row key={u.id} user={u} onChanged={load} teamGroup={teamGroup} outlets={outlets} level={level} />
          ))}
        </ul>
      )}
      {!manager && <AccountabilityTable />}
    </div>
  );
}
