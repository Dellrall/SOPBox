import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AtSign, BellRing, Camera, ClipboardCheck, Eye, EyeOff, Lock, Mail, ScrollText, ShieldCheck, Store, Thermometer, UserRound, type LucideIcon } from "lucide-react";
import { api } from "./api";
import type { PublicPath } from "./App";
import type { KitchenScreen, Me } from "./types";
import { ErrorNote, inputClass, labelClass, primaryButton } from "./ui";
import { SdgFooter } from "./Sdg";
import { PolicyLinks } from "./Site";
import { KitchenSignIn, LastUsed, OtherSignIns } from "./OtherSignIns";
import { lastSignIn } from "./signin";
import { USERNAME_HINT, USERNAME_PATTERN, UsernameStatus, cleanUsername, usernameProblem, useUsernameCheck } from "./username";

type Mode = "signin" | "register";

const STEPS = [
  { icon: Camera, title: "AI reads the delivery order", text: "Snap the supplier's order. Lines fill in for staff to confirm." },
  { icon: Thermometer, title: "Rules check every line", text: "Temperature, pack conversion and quantity, against your own SOP." },
  { icon: ClipboardCheck, title: "Managers approve failures", text: "Accept, reject or return, with a reason. Nothing slips through." },
  { icon: BellRing, title: "Everyone is told, everything is logged", text: "Telegram alerts and a full audit trail of who did what, when." },
];

/** A labelled input with an icon inside it on the left. */
function Field({ id, label, icon: Icon, children }: { id: string; label: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Icon aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        {children}
      </div>
    </div>
  );
}

// Matches _password in app/models.py, which refuses these on the server.
const COMMON = ["password", "password1", "password123", "passw0rd", "iloveyou", "sopbox123", "welcome1", "abcd1234", "qwerty123"];
const RUNS = ["01234567890", "09876543210", "abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm"];
const easyPassword = (p: string) => {
  const low = p.toLowerCase();
  return new Set(low).size < 4 || COMMON.includes(low) || RUNS.some((run) => run.includes(low));
};

/** 0 to 3: too short or easy to guess, OK, good, strong. */
function strength(p: string): number {
  if (p.length < 8 || easyPassword(p)) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(p)).length;
  return Math.min(3, 1 + (p.length >= 12 ? 1 : 0) + (kinds >= 3 ? 1 : 0));
}

const STRENGTH = [
  { label: "Too easy to guess", bar: "bg-red-500", text: "text-red-700" },
  { label: "OK", bar: "bg-amber-500", text: "text-amber-800" },
  { label: "Good", bar: "bg-brand-500", text: "text-brand-700" },
  { label: "Strong", bar: "bg-brand-700", text: "text-brand-800" },
];

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const score = strength(password);
  const s = STRENGTH[score];
  return (
    <div className="mt-1.5">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= score ? s.bar : "bg-slate-200"}`} />
        ))}
      </div>
      <p className={`mt-1 text-xs font-semibold ${s.text}`} aria-live="polite">
        Password: {s.label}
        {score === 0 && <span className="font-normal text-muted"> · {password.length < 8 ? "use at least 8 characters" : "use a few words, or mix letters and numbers"}</span>}
      </p>
    </div>
  );
}

const groupClass = "space-y-3 rounded-2xl border border-line bg-white p-4 shadow-sm";
const groupTitle = "text-xs font-bold uppercase tracking-wider text-brand-700";

/** Sign in, or create a new workspace. The person who creates a workspace becomes its owner. */
export default function AuthPage({
  mode,
  navigate,
  onSignedIn,
}: {
  mode: Mode;
  navigate: (to: PublicPath) => void;
  onSignedIn: (me: Me) => void;
}) {
  const setMode = (m: Mode) => navigate(m === "register" ? "/register" : "/signin");
  useEffect(() => {
    document.title = mode === "register" ? "Create a workspace · SOPBox" : "Sign in · SOPBox";
    // Whatever was typed for signing in (perhaps an email) must still be a valid new username.
    if (mode === "register") setUsername((u) => cleanUsername(u).value);
  }, [mode]);
  const [workspace, setWorkspace] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const usernameCheck = useUsernameCheck(username, mode !== "register");
  const [password, setPassword] = useState("");
  const [dropped, setDropped] = useState(false); // a typed character was not allowed in a username
  // The username follows the email's first part until the person types one of their own.
  const [usernameTyped, setUsernameTyped] = useState(false);
  const [usernameFocus, setUsernameFocus] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // On a kitchen tablet, people tap their name and type a PIN instead.
  const [kitchen, setKitchen] = useState<KitchenScreen | null>(null);
  const [usePassword, setUsePassword] = useState(false);
  useEffect(() => {
    api.kitchenScreen().then(setKitchen).catch(() => setKitchen(null));
  }, []);
  const onTablet = mode === "signin" && kitchen !== null && !usePassword;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (mode === "register" && usernameProblem(username)) return setError(`Username: ${usernameProblem(username)}`);
    setBusy(true);
    try {
      onSignedIn(
        mode === "signin"
          ? await api.login(username, password)
          : await api.register({
              workspace_name: workspace,
              display_name: name,
              email,
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
      className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold leading-tight transition ${
        mode === m ? "bg-white text-brand-950 shadow-sm" : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="hero-pattern relative flex flex-col justify-between overflow-hidden px-5 py-4 text-white sm:px-10 sm:py-8 lg:min-h-screen lg:px-14 lg:py-12">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="flex w-fit items-center gap-3 rounded-xl"
        >
          <img src="/logo-128.webp" alt="" width={44} height={44} className="h-9 w-9 rounded-xl object-cover ring-2 ring-white/15 sm:h-11 sm:w-11" />
          <span className="text-xl font-bold">SOPBox</span>
          <span className="sr-only">: back to the welcome page</span>
        </a>

        {/* A kitchen tablet goes straight to the names below; phones keep only the headline, so the
            form is in reach without scrolling, and upright tablets skip the feature list. */}
        <div className={`mt-3 max-w-xl sm:my-10 lg:my-0 ${onTablet ? "hidden lg:block" : ""}`}>
          <h1 className="text-xl font-extrabold leading-tight sm:text-4xl lg:text-5xl">
            Receiving checks that <span className="text-sand">catch problems at the door.</span>
          </h1>
          <p className="mt-4 hidden max-w-lg text-base text-white/75 sm:block sm:text-lg">
            SOPBox turns every delivery into a quick, guided check on a phone, so wrong temperatures, short
            packs and missing items are stopped before they reach your kitchen.
          </p>
          <ul className="mt-8 hidden gap-5 lg:grid lg:grid-cols-2">
            {STEPS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon aria-hidden className="h-[18px] w-[18px] text-leaf" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-sm text-white/65">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="hidden items-center gap-2 text-sm text-white/60 lg:flex">
          <ScrollText aria-hidden className="h-4 w-4" /> AI reads. Rules decide. Humans approve.
        </p>
      </section>

      <main className="flex flex-1 flex-col items-center bg-surface px-4 py-5 sm:px-6 sm:py-10 lg:justify-center">
        {/* Fills the screen on phones, so the footer sits at the bottom of the screen, not mid-page. */}
        <div className="flex w-full max-w-md flex-1 flex-col lg:flex-none">
          <h2 className="hidden text-2xl font-bold text-brand-950 sm:block">{mode === "signin" ? "Welcome back" : "Create your workspace"}</h2>
          <p className="mt-1 hidden text-sm text-muted sm:block">
            {mode === "signin"
              ? "Sign in to record and check today's deliveries."
              : "You'll be the owner. You can add your managers and staff next."}
          </p>

          <div role="tablist" aria-label="Sign in or create a workspace" className="flex gap-1 rounded-xl sm:mt-6 bg-slate-200/60 p-1">
            {tab("signin", "Sign in")}
            {tab("register", "Create a workspace")}
          </div>

          {onTablet && <KitchenSignIn screen={kitchen} onSignedIn={onSignedIn} onUsePassword={() => setUsePassword(true)} onForgotten={() => setKitchen(null)} />}

          <form hidden={onTablet} onSubmit={(e) => void submit(e)} className="mt-4 space-y-3 sm:mt-6 sm:space-y-4">
            {mode === "register" && (
              <section aria-label="Your business" className={groupClass}>
                <p className={groupTitle}>Your business</p>
                <Field id="workspace" label="Business name" icon={Store}>
                  <input id="workspace" required maxLength={80} autoComplete="organization" placeholder="e.g. Kopi Corner Sdn Bhd" className={`${inputClass} pl-9`} value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
                </Field>
                <Field id="display-name" label="Your name" icon={UserRound}>
                  <input id="display-name" required maxLength={80} autoComplete="name" placeholder="e.g. Aina Rahman" className={`${inputClass} pl-9`} value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
              </section>
            )}
            <section aria-label={mode === "register" ? "Your sign-in" : undefined} className={mode === "register" ? groupClass : "space-y-3 sm:space-y-4"}>
              {mode === "register" && <p className={groupTitle}>Your sign-in</p>}
              {mode === "register" && (
                <Field id="email" label="Email" icon={Mail}>
                  <input
                    id="email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    placeholder="you@business.com"
                    className={`${inputClass} pl-9`}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (!usernameTyped) setUsername(cleanUsername(e.target.value.split("@")[0]).value);
                    }}
                  />
                </Field>
              )}
              <div>
                <Field id="username" label={mode === "signin" ? "Username or email" : "Username"} icon={AtSign}>
                  <input
                    id="username"
                    required
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    {...(mode === "register" ? { minLength: 3, maxLength: 32, pattern: USERNAME_PATTERN, title: USERNAME_HINT } : { maxLength: 254 })}
                    aria-describedby={mode === "register" ? "username-hint" : undefined}
                    className={`${inputClass} pl-9`}
                    value={username}
                    onFocus={() => setUsernameFocus(true)}
                    onBlur={() => setUsernameFocus(false)}
                    onChange={(e) => {
                      if (mode !== "register") return setUsername(e.target.value);
                      const cleaned = cleanUsername(e.target.value);
                      setUsername(cleaned.value);
                      setDropped(cleaned.removed);
                      setUsernameTyped(true);
                    }}
                  />
                </Field>
                {mode === "register" && <UsernameStatus check={usernameCheck} />}
                {mode === "register" && (
                  // The rules show while typing a username, or when a character was left out.
                  <p
                    id="username-hint"
                    className={dropped || usernameFocus ? `mt-1 text-xs ${dropped ? "font-semibold text-amber-800" : "text-muted"}` : "sr-only"}
                    aria-live="polite"
                  >
                    {dropped ? "Spaces and symbols can't be used in a username, so they were left out. " : ""}
                    {USERNAME_HINT}
                  </p>
                )}
              </div>
              <Field id="password" label="Password" icon={Lock}>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={mode === "register" ? 8 : 1}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  placeholder={mode === "register" ? "At least 8 characters" : undefined}
                  className={`${inputClass} pl-9 pr-11`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                >
                  {showPassword ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
                </button>
              </Field>
              {mode === "register" && <PasswordStrength password={password} />}
            </section>
            {mode === "register" && (
              <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                <strong>Free plan:</strong> 1 outlet and up to 50 products. One free workspace per business: extra free workspaces for the
                same business may be closed. Upgrade to Pro any time in Settings.
              </p>
            )}
            <ErrorNote message={error} />
            <button type="submit" disabled={busy} className={`${primaryButton} relative w-full py-3 text-base`}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create workspace"}
              {mode === "signin" && <LastUsed method="password" on={lastSignIn()} />}
            </button>
            {mode === "register" && (
              <p className="text-center text-xs text-muted">Free for one store, no card needed. You'll be the owner and can add your team next.</p>
            )}
          </form>
          {mode === "signin" && !onTablet && <OtherSignIns onSignedIn={onSignedIn} />}
          {mode === "signin" && !onTablet && (
            <details className="mt-4 rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted">
              <summary className="cursor-pointer font-semibold text-ink">Trouble signing in?</summary>
              <p className="mt-2">
                <strong className="text-ink">Staff or manager?</strong> Your owner creates your account. Ask them for your
                username and password.
              </p>
              <p className="mt-2">Passkeys, Google and Telegram work once you've set them up in Settings.</p>
            </details>
          )}
          <div className="mt-auto pt-10">
            <SdgFooter />
            <PolicyLinks className="mt-4" />
          </div>
        </div>
      </main>
    </div>
  );
}
