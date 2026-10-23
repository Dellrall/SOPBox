import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import type { UserOut } from "./types";
import { Empty, ErrorNote, PageTitle, ROLE_LABEL, cardClass, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"manager" | "staff">("staff");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDone("");
    try {
      const made = await api.createUser({ username, display_name: name, role, password });
      setDone(`Account created. Give ${made.display_name} the username "${made.username}" and the password you just set.`);
      setName("");
      setUsername("");
      setPassword("");
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={`${cardClass} space-y-3`}>
      <h2 className="text-lg font-semibold text-brand-900">Create an account</h2>
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
          <input id="u-username" required autoCapitalize="none" className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="u-role">
            Role
          </label>
          <select id="u-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value as "manager" | "staff")}>
            <option value="staff">Staff: receives deliveries</option>
            <option value="manager">Manager: also edits products and approves</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="u-password">
            Starting password
          </label>
          <input id="u-password" required minLength={8} autoComplete="new-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-xs text-slate-600">At least 8 characters. They can change it under Settings.</p>
        </div>
      </div>
      <ErrorNote message={error} />
      {done && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">{done}</p>}
      <button type="submit" disabled={busy} className={primaryButton}>
        Create account
      </button>
    </form>
  );
}

function Row({ user, onChanged }: { user: UserOut; onChanged: () => void }) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const isOwner = user.role === "owner";

  async function change(body: Parameters<typeof api.updateUser>[1]) {
    setError("");
    try {
      await api.updateUser(user.id, body);
      setResetting(false);
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
          <p className="text-sm text-slate-600">
            {user.username} · {ROLE_LABEL[user.role]}
          </p>
        </div>
        {!isOwner && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`role-${user.id}`}>
              Role of {user.display_name}
            </label>
            <select
              id={`role-${user.id}`}
              className={`${inputClass} w-auto`}
              value={user.role}
              onChange={(e) => void change({ role: e.target.value as "manager" | "staff" })}
            >
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
            </select>
            <button className={secondaryButton} onClick={() => setResetting((r) => !r)}>
              Reset password
            </button>
            <button className={secondaryButton} onClick={() => void change({ active: !user.active })}>
              {user.active ? "Disable" : "Enable"}
            </button>
          </div>
        )}
      </div>
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
export default function Team() {
  const [users, setUsers] = useState<UserOut[] | null>(null);
  const [error, setError] = useState("");

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
      <PageTitle title="Team" />
      <p className="text-sm text-slate-600">
        You are the owner. Staff can receive deliveries. Managers can also edit products and approve
        failed deliveries. Only you manage accounts.
      </p>
      <CreateForm onCreated={load} />
      <ErrorNote message={error} />
      {users?.length === 0 && <Empty>No accounts yet.</Empty>}
      {users && (
        <ul className={`${cardClass} divide-y divide-line`}>
          {users.map((u) => (
            <Row key={u.id} user={u} onChanged={load} />
          ))}
        </ul>
      )}
    </div>
  );
}
