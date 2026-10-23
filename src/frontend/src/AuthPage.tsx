import { useState, type FormEvent } from "react";
import { api } from "./api";
import type { Me } from "./types";
import { ErrorNote, cardClass, inputClass, labelClass, primaryButton } from "./ui";

type Mode = "signin" | "register";

/** Sign in, or create a new workspace. The person who creates a workspace becomes its owner. */
export default function AuthPage({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [workspace, setWorkspace] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      onSignedIn(
        mode === "signin"
          ? await api.login(username, password)
          : await api.register({
              workspace_name: workspace,
              display_name: name,
              username,
              password,
            }),
      );
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => {
        setMode(m);
        setError("");
      }}
      className={`flex-1 border-b-2 py-2 text-sm font-medium ${
        mode === m ? "border-brand-600 text-brand-900" : "border-transparent text-slate-500 hover:text-slate-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className={`${cardClass} w-full max-w-md space-y-4 p-6`}>
        <div className="flex items-center gap-3">
          <img src="/SOPBox_Logo.jpeg" alt="" className="h-12 w-12 rounded-lg object-cover" />
          <div>
            <h1 className="text-xl font-semibold text-brand-900">SOPBox</h1>
            <p className="text-sm text-slate-600">Receiving checks for your kitchen</p>
          </div>
        </div>

        <div role="tablist" className="flex border-b border-line">
          {tab("signin", "Sign in")}
          {tab("register", "Create a workspace")}
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          {mode === "register" && (
            <>
              <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
                You will be the owner of this workspace. You can then create accounts for your managers
                and staff.
              </p>
              <div>
                <label className={labelClass} htmlFor="workspace">
                  Business name
                </label>
                <input id="workspace" required maxLength={80} className={inputClass} value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
              </div>
              <div>
                <label className={labelClass} htmlFor="display-name">
                  Your name
                </label>
                <input id="display-name" required maxLength={80} autoComplete="name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <label className={labelClass} htmlFor="username">
              Username
            </label>
            <input
              id="username"
              required
              autoComplete="username"
              autoCapitalize="none"
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            {mode === "register" && (
              <p className="mt-1 text-xs text-slate-600">3 to 32 characters: letters, digits, dot, dash or underscore.</p>
            )}
          </div>
          <div>
            <label className={labelClass} htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={mode === "register" ? 8 : 1}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === "register" && <p className="mt-1 text-xs text-slate-600">At least 8 characters.</p>}
          </div>
          <ErrorNote message={error} />
          <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create workspace"}
          </button>
        </form>
        {mode === "signin" && (
          <p className="text-sm text-slate-600">
            Employees: your owner creates your account. Ask them for a username and password.
          </p>
        )}
      </div>
    </main>
  );
}
