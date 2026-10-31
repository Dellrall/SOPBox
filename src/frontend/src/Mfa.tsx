import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck } from "lucide-react";
import { api, setCodeHandler } from "./api";
import type { Me, MfaPolicy, UserOut } from "./types";
import {
  ErrorNote,
  SectionTitle,
  SuccessNote,
  cardClass,
  dangerButton,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./ui";
import { Select } from "./Select";

/** The 6-digit box, also taking a backup code. */
function CodeForm({
  submitLabel,
  onCode,
  children,
}: {
  submitLabel: string;
  onCode: (code: string) => Promise<void>;
  children?: React.ReactNode;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onCode(code.trim());
    } catch (err) {
      setError((err as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <div>
        <label className={labelClass} htmlFor="mfa-code">
          Code from your authenticator app
        </label>
        <input
          id="mfa-code"
          required
          autoFocus
          minLength={6}
          maxLength={20}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          className={`${inputClass} font-mono tracking-widest`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted">Lost your phone? Type one of your backup codes instead.</p>
      </div>
      <ErrorNote message={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primaryButton} disabled={busy}>
          {submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}

/** After the password (or Google, Telegram, PIN), a session with two-step sign-in waits here. */
export function MfaGate({ onDone, onSignOut }: { onDone: (me: Me) => void; onSignOut: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className={`${cardClass} w-full max-w-sm space-y-4`}>
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden className="h-6 w-6 text-brand-600" />
          <h1 className="text-lg font-semibold text-ink">Two-step sign-in</h1>
        </div>
        <p className="text-sm text-muted">
          Lost your phone? Type a backup code below, or sign out and sign in with a passkey. No backup codes or passkey? Ask your workspace
          owner to reset your two-step sign-in in Team. An owner with neither asks whoever runs SOPBox.
        </p>
        <CodeForm submitLabel="Finish signing in" onCode={async (code) => onDone(await api.mfaVerify(code))}>
          <button type="button" className={secondaryButton} onClick={onSignOut}>
            Sign out
          </button>
        </CodeForm>
      </div>
    </div>
  );
}

/** Asks for a code whenever a dangerous action needs one (HTTP 428), then lets it go ahead. */
export function CodePrompt() {
  const [open, setOpen] = useState(false);
  const settle = useRef<(ok: boolean) => void>(() => undefined);

  useEffect(() => {
    setCodeHandler(
      () =>
        new Promise<boolean>((resolve) => {
          settle.current = (ok) => {
            setOpen(false);
            resolve(ok);
          };
          setOpen(true);
        }),
    );
  }, []);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-950/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mfa-title"
    >
      <div className={`${cardClass} w-full max-w-sm space-y-3`}>
        <h2 id="mfa-title" className="text-lg font-semibold text-ink">
          Confirm it's you
        </h2>
        <p className="text-sm text-muted">This action is hard to undo. The people in charge will be told about it.</p>
        <CodeForm
          submitLabel="Confirm"
          onCode={async (code) => {
            await api.mfaVerify(code);
            settle.current(true);
          }}
        >
          <button type="button" className={secondaryButton} onClick={() => settle.current(false)}>
            Cancel
          </button>
        </CodeForm>
      </div>
    </div>,
    document.body,
  );
}

/** Turning two-step sign-in on and off for yourself. */
export function TwoStep({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [backups, setBackups] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  return (
    <section className={`${cardClass} space-y-3`}>
      <div>
        <SectionTitle>Two-step sign-in</SectionTitle>
        <p className="mt-1 text-sm text-muted">
          With an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…), signing in and actions that are hard to undo
          also need a 6-digit code from your phone. A passkey sign-in counts as both steps.
        </p>
      </div>
      <ErrorNote message={error} />
      {me.mfa_setup_needed && !backups && (
        <p className="text-sm font-semibold text-amber-800">
          Your workspace requires this. Until it is on, actions that are hard to undo are blocked.
        </p>
      )}
      {backups ? (
        <div className="space-y-2 rounded-xl bg-brand-50 px-3 py-2.5 text-sm">
          <SuccessNote>Two-step sign-in is on. If you lose your phone, a backup code or a passkey sign-in gets you back in.</SuccessNote>
          <p>Keep these backup codes somewhere safe, away from your phone. Each works once. They are not shown again.</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-ink" data-testid="backup-codes">
            {backups.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              setBackups(null);
              onChanged();
            }}
          >
            I've saved them
          </button>
        </div>
      ) : me.mfa_enabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex-1 text-sm font-semibold text-emerald-700">On</span>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              if (!window.confirm("Make 10 new backup codes? The old ones stop working.")) return;
              setError("");
              api
                .mfaBackupCodes()
                .then((r) => setBackups(r.backup_codes))
                .catch((e: Error) => setError(e.message));
            }}
          >
            New backup codes
          </button>
          <button
            type="button"
            className={dangerButton}
            onClick={() => {
              if (!window.confirm("Turn off two-step sign-in?")) return;
              setError("");
              api
                .mfaDisable()
                .then(onChanged)
                .catch((e: Error) => setError(e.message));
            }}
          >
            Turn off
          </button>
        </div>
      ) : setup ? (
        <div className="space-y-3 text-sm">
          <p>
            1. Get a free authenticator app (Google Authenticator or Microsoft Authenticator). In it, tap +, choose
            "Enter a setup key" and type this key, or{" "}
            <a className="font-semibold text-brand-700 underline" href={setup.uri}>
              open it in the app
            </a>{" "}
            on this phone:
          </p>
          <code className="block break-all rounded-xl bg-slate-100 p-3 font-mono text-ink" data-testid="mfa-secret">
            {setup.secret.match(/.{1,4}/g)?.join(" ")}
          </code>
          <p>2. The app now shows a 6-digit code that changes every 30 seconds. Type it here.</p>
          <CodeForm
            submitLabel="Turn on"
            onCode={async (code) => {
              setBackups((await api.mfaEnable(code)).backup_codes);
              setSetup(null);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className={primaryButton}
          onClick={() => {
            setError("");
            api
              .mfaSetup()
              .then(setSetup)
              .catch((e: Error) => setError(e.message));
          }}
        >
          Set up two-step sign-in
        </button>
      )}
    </section>
  );
}

const POLICY: { value: MfaPolicy; label: string }[] = [
  { value: "off", label: "Nobody (each person chooses)" },
  { value: "managers", label: "Owners and managers" },
  { value: "everyone", label: "Everyone" },
];

/** The owner decides who must use two-step sign-in, and who besides them hears about dangerous actions. */
export function SecurityPolicy() {
  const [policy, setPolicy] = useState<MfaPolicy | null>(null);
  const [users, setUsers] = useState<UserOut[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    api
      .workspace()
      .then((w) => setPolicy(w.mfa_policy))
      .catch((e: Error) => setError(e.message));
    api
      .users()
      .then(setUsers)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function run(action: () => Promise<void>, done: string) {
    setError("");
    setSaved("");
    try {
      await action();
      setSaved(done);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (policy === null) return <ErrorNote message={error} />;
  return (
    <section className={`${cardClass} space-y-3`}>
      <SectionTitle>Security rules</SectionTitle>
      <div>
        <label className={labelClass} htmlFor="mfa-policy">
          Two-step sign-in required for
        </label>
        <Select
          id="mfa-policy"
          className={inputClass}
          value={policy}
          choices={POLICY}
          onChange={(v) => {
            const next = v as MfaPolicy;
            void run(async () => setPolicy((await api.updateWorkspace({ mfa_policy: next })).mfa_policy), "Rule saved.");
          }}
        />
        <p className="mt-1 text-xs text-muted">
          People it applies to can still sign in, but must turn it on before doing anything hard to undo.
        </p>
      </div>
      <fieldset>
        <legend className={labelClass}>Security alerts also go to</legend>
        <p className="mb-2 text-xs text-muted">
          The owner always hears, in the inbox and on Telegram, when someone makes or revokes API keys, changes the team or the workspace,
          imports or deletes in bulk, or changes their own sign-in.
        </p>
        <ul className="space-y-1 text-sm">
          {users
            .filter((u) => u.role !== "owner" && u.active)
            .map((u) => (
              <li key={u.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={u.security_alerts}
                    onChange={(e) => {
                      const on = e.target.checked;
                      void run(
                        async () => {
                          const updated = await api.updateUser(u.id, {
                            security_alerts: on,
                          });
                          setUsers((all) => all.map((x) => (x.id === u.id ? updated : x)));
                        },
                        on ? `${u.display_name} will get security alerts.` : `${u.display_name} will no longer get security alerts.`,
                      );
                    }}
                  />
                  {u.display_name}{" "}
                  <span className="text-muted">
                    ({u.role}
                    {u.mfa_enabled ? ", two-step on" : ""})
                  </span>
                </label>
              </li>
            ))}
        </ul>
      </fieldset>
      <fieldset>
        <legend className={labelClass}>Can download data</legend>
        <p className="mb-2 text-xs text-muted">
          You always can. People you tick get Settings, Download your data, with only the sections they can already see.
        </p>
        <ul className="space-y-1 text-sm">
          {users
            .filter((u) => u.role !== "owner" && u.active)
            .map((u) => (
              <li key={u.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={u.can_export}
                    onChange={(e) => {
                      const on = e.target.checked;
                      void run(
                        async () => {
                          const updated = await api.updateUser(u.id, { can_export: on });
                          setUsers((all) => all.map((x) => (x.id === u.id ? updated : x)));
                        },
                        on ? `${u.display_name} can download data.` : `${u.display_name} can no longer download data.`,
                      );
                    }}
                  />
                  {u.display_name} <span className="text-muted">({u.role})</span>
                </label>
              </li>
            ))}
        </ul>
      </fieldset>
      <ErrorNote message={error} />
      {saved && <SuccessNote>{saved}</SuccessNote>}
    </section>
  );
}
