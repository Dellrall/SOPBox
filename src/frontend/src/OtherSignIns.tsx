import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Fingerprint, Send } from "lucide-react";
import { api } from "./api";
import type { KitchenScreen, Me, SignInMethods } from "./types";
import { ErrorNote, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";
import { consumeTelegram, passkeyError, passkeysSupported, signInWithPasskey, takeAuthReturn, telegramLoginUrl } from "./signin";

const optionButton = `${secondaryButton} w-full justify-center py-3 text-base`;

/** Google's "G", drawn as Google's brand guidelines ask for its sign-in button. */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="h-5 w-5">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.8 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** Passkey, Google and Telegram buttons under the password form, plus finishing a Telegram return. */
export function OtherSignIns({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [error, setError] = useState(() => takeAuthReturn().error ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.signInMethods().then(setMethods).catch(() => setMethods({ google: false, telegram_bot_id: null }));
    const telegram = consumeTelegram();
    if (telegram) {
      setBusy(true);
      api
        .telegramLogin(telegram)
        .then(onSignedIn)
        .catch((e: Error) => {
          setError(e.message);
          setBusy(false);
        });
    }
  }, [onSignedIn]);

  async function passkey() {
    setError("");
    setBusy(true);
    try {
      onSignedIn(await signInWithPasskey());
    } catch (e) {
      setError(passkeyError(e));
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      {passkeysSupported() && (
        <button type="button" className={optionButton} disabled={busy} onClick={() => void passkey()}>
          <Fingerprint aria-hidden className="h-5 w-5" /> Sign in with a passkey
        </button>
      )}
      {methods?.google && (
        <a href="/api/auth/google/start?mode=login" className={optionButton}>
          <GoogleMark /> Continue with Google
        </a>
      )}
      {methods?.telegram_bot_id && (
        <a href={telegramLoginUrl(methods.telegram_bot_id, "/signin")} className={optionButton}>
          <Send aria-hidden className="h-5 w-5 text-[#229ED9]" /> Continue with Telegram
        </a>
      )}
      <ErrorNote message={error} />
      <p className="text-xs text-muted">Passkeys, Google and Telegram work once you've set them up in Settings.</p>
    </div>
  );
}

/** A kitchen tablet's sign-in: tap your name, then type your PIN. */
export function KitchenSignIn({
  screen,
  onSignedIn,
  onUsePassword,
  onForgotten,
}: {
  screen: KitchenScreen;
  onSignedIn: (me: Me) => void;
  onUsePassword: () => void;
  onForgotten: () => void;
}) {
  const [person, setPerson] = useState<{ id: number; display_name: string } | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!person) return;
    setError("");
    setBusy(true);
    try {
      onSignedIn(await api.kitchenLogin(person.id, pin));
    } catch (err) {
      setError((err as Error).message);
      setPin("");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <p className="text-sm text-muted">
        <strong className="text-ink">{screen.device_name}</strong> · {screen.workspace_name}
      </p>
      {!person ? (
        <>
          <h3 className="font-semibold text-brand-950">Who's signing in?</h3>
          {screen.people.length === 0 ? (
            <p className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted">
              Nobody has a PIN yet. Each person sets one in Settings, under Security.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {screen.people.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setPerson(p)}
                    className="flex min-h-20 w-full items-center justify-center rounded-2xl border border-line bg-white px-3 py-4 text-center text-base font-semibold text-brand-950 shadow-sm hover:bg-brand-50 active:scale-[0.98]"
                  >
                    {p.display_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setPerson(null);
              setPin("");
              setError("");
            }}
            className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
          >
            <ArrowLeft aria-hidden className="h-4 w-4" /> Not {person.display_name}?
          </button>
          <div>
            <label className={labelClass} htmlFor="kitchen-pin">
              {person.display_name}'s PIN
            </label>
            <input
              id="kitchen-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d{4,8}"
              minLength={4}
              maxLength={8}
              required
              autoFocus
              className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <ErrorNote message={error} />
          <button type="submit" disabled={busy || pin.length < 4} className={`${primaryButton} w-full py-3 text-base`}>
            {busy ? "Please wait…" : "Sign in"}
          </button>
        </form>
      )}
      <div className="flex flex-wrap justify-between gap-x-6 gap-y-2 text-sm font-semibold">
        <button type="button" onClick={onUsePassword} className="text-muted hover:text-ink hover:underline">
          Sign in another way
        </button>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(`Stop using this device as ${screen.device_name}? A manager can set it up again in Settings.`)) return;
            api.forgetKitchenTablet().then(onForgotten, (err: Error) => window.alert(err.message));
          }}
          className="text-red-700 hover:underline"
        >
          Stop using as a kitchen tablet
        </button>
      </div>
    </div>
  );
}
