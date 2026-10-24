import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Fingerprint, KeyRound, Send, Tablet, Trash2 } from "lucide-react";
import { api } from "./api";
import type { KitchenDevice, Security as SecurityState, SignInMethods } from "./types";
import { ErrorNote, SectionTitle, SuccessNote, cardClass, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";
import { addPasskey, consumeTelegram, describeSignIn, passkeyError, passkeysSupported, takeAuthReturn, telegramLoginUrl, thisDeviceName } from "./signin";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function Method({ icon, title, status, children }: { icon: ReactNode; title: string; status: string; children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{title}</p>
        <p className="text-sm text-muted">{status}</p>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

/** Your own ways of signing in, and where you signed in recently. */
export function SignInSecurity() {
  const [state, setState] = useState<SecurityState | null>(null);
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [error, setError] = useState(() => takeAuthReturn().error ?? "");
  const [notice, setNotice] = useState(() => takeAuthReturn().notice ?? "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.security().then(setState).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    api.signInMethods().then(setMethods).catch(() => undefined);
    // Back from Telegram's login page with an answer to connect.
    const telegram = consumeTelegram();
    if (telegram)
      api
        .telegramLink(telegram)
        .then(() => {
          setNotice("Telegram is connected. Next time, tap Continue with Telegram.");
          load();
        })
        .catch((e: Error) => setError(e.message));
  }, [load]);

  async function run(action: () => Promise<unknown>, done: string) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
      setNotice(done);
      load();
    } catch (e) {
      setError(passkeyError(e));
    } finally {
      setBusy(false);
    }
  }

  function savePin(e: FormEvent) {
    e.preventDefault();
    void run(() => api.setPin(pin), "PIN saved. Use it on the kitchen tablet.").then(() => setPin(""));
  }

  if (!state) return <section className={cardClass}><SectionTitle>Sign-in &amp; security</SectionTitle><ErrorNote message={error} /></section>;

  return (
    <section className={`${cardClass} space-y-3`}>
      <div>
        <SectionTitle>Sign-in &amp; security</SectionTitle>
        <p className="mt-1 text-sm text-muted">Set up a quicker way in. Your password keeps working too.</p>
      </div>
      <ul className="divide-y divide-line">
        <Method
          icon={<Fingerprint aria-hidden className="h-5 w-5" />}
          title="Passkey"
          status={
            state.passkeys.length
              ? `Fingerprint, face or screen lock. ${state.passkeys.length} added.`
              : "Sign in with your fingerprint, face or screen lock. No password to type."
          }
        >
          {passkeysSupported() ? (
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => void run(() => addPasskey(thisDeviceName()), "Passkey added. Next time, tap Sign in with a passkey.")}>
              Add a passkey on this device
            </button>
          ) : (
            <span className="text-sm text-muted">This browser can't make passkeys.</span>
          )}
        </Method>
        {state.passkeys.length > 0 && (
          <li className="pb-3">
            <ul className="space-y-1.5 pl-12">
              {state.passkeys.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">
                    <span className="font-medium text-ink">{p.name}</span>{" "}
                    <span className="text-muted">· added {when(p.created_at)}{p.last_used_at ? ` · last used ${when(p.last_used_at)}` : ""}</span>
                  </span>
                  <button type="button" className="rounded-lg p-1.5 text-red-700 hover:bg-red-50" aria-label={`Remove passkey ${p.name}`} disabled={busy} onClick={() => void run(() => api.removePasskey(p.id), "Passkey removed.")}>
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </li>
        )}
        {methods?.google && (
          <Method icon={<span className="text-base font-bold">G</span>} title="Google" status={state.google_linked ? "Connected." : "Sign in with your Google account."}>
            {state.google_linked ? (
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => void run(() => api.unlink("google"), "Google disconnected.")}>
                Disconnect
              </button>
            ) : (
              <a href="/api/auth/google/start?mode=link" className={secondaryButton}>
                Connect Google
              </a>
            )}
          </Method>
        )}
        {methods?.telegram_bot_id && (
          <Method icon={<Send aria-hidden className="h-5 w-5" />} title="Telegram" status={state.telegram_linked ? "Connected." : "Sign in with the Telegram app on your phone."}>
            {state.telegram_linked ? (
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => void run(() => api.unlink("telegram"), "Telegram disconnected.")}>
                Disconnect
              </button>
            ) : (
              <a href={telegramLoginUrl(methods.telegram_bot_id, "/settings")} className={secondaryButton}>
                Connect Telegram
              </a>
            )}
          </Method>
        )}
        <Method
          icon={<KeyRound aria-hidden className="h-5 w-5" />}
          title="Kitchen tablet PIN"
          status={state.pin_set ? "Set. Tap your name on the kitchen tablet, then type it." : "4 to 8 digits, for signing in on the shared kitchen tablet."}
        >
          <form onSubmit={savePin} className="flex gap-2">
            <label className="sr-only" htmlFor="new-pin">
              New PIN
            </label>
            <input
              id="new-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d{4,8}"
              minLength={4}
              maxLength={8}
              placeholder={state.pin_set ? "New PIN" : "PIN"}
              className={`${inputClass} w-28 py-2`}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
            <button type="submit" className={secondaryButton} disabled={busy || pin.length < 4}>
              {state.pin_set ? "Change" : "Set PIN"}
            </button>
            {state.pin_set && (
              <button type="button" className={secondaryButton} disabled={busy} onClick={() => void run(() => api.setPin(null), "PIN removed.")}>
                Remove
              </button>
            )}
          </form>
        </Method>
      </ul>
      <ErrorNote message={error} />
      {notice && <SuccessNote>{notice}</SuccessNote>}

      <div className="border-t border-line pt-3">
        <h3 className="text-sm font-semibold text-slate-700">Recent sign-ins</h3>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          {state.recent_sign_ins.map((s, i) => (
            <li key={s.id}>
              {describeSignIn(s)}
              {i === 0 && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">latest</span>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Don't recognise one? Change your password above; that signs out every other device.</p>
      </div>
    </section>
  );
}

/** Managers mark shared kitchen tablets, where people sign in with their PIN. */
export function KitchenTablets() {
  const [devices, setDevices] = useState<KitchenDevice[] | null>(null);
  const [name, setName] = useState("Kitchen tablet");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.kitchenDevices().then(setDevices).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function change(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const here = devices?.some((d) => d.this_device);
  return (
    <section className={`${cardClass} space-y-3`}>
      <SectionTitle>Kitchen tablets</SectionTitle>
      <p className="text-sm text-muted">
        On a shared tablet, people tap their name and type their PIN instead of a password. Their session ends after 12 hours.
      </p>
      {devices && devices.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <Tablet aria-hidden className="h-4 w-4 text-brand-700" />
              <span className="flex-1">
                <span className="font-semibold text-ink">{d.name}</span>
                {d.this_device && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">this device</span>}
                <span className="block text-xs text-muted">
                  Added by {d.created_by} on {when(d.created_at)}{d.last_used_at ? ` · last used ${when(d.last_used_at)}` : ""}
                </span>
              </span>
              <button type="button" className="rounded-lg p-1.5 text-red-700 hover:bg-red-50" aria-label={`Remove ${d.name}`} onClick={() => void change(() => api.removeKitchenDevice(d.id))}>
                <Trash2 aria-hidden className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!here && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void change(() => api.addKitchenDevice(name.trim() || "Kitchen tablet"));
          }}
        >
          <div className="min-w-48 flex-1">
            <label className={labelClass} htmlFor="tablet-name">
              Name for this device
            </label>
            <input id="tablet-name" maxLength={60} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button type="submit" className={primaryButton}>
            Use this device as a kitchen tablet
          </button>
        </form>
      )}
      <ErrorNote message={error} />
    </section>
  );
}
