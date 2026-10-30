import { useEffect, useState, type FormEvent } from "react";
import { BellRing, Camera, ClipboardCheck, ScrollText, ShieldCheck, Thermometer } from "lucide-react";
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
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
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
          <p className="mb-4 hidden sm:inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-leaf ring-1 ring-white/15">
            <ShieldCheck aria-hidden className="h-3.5 w-3.5" /> For food &amp; beverage SMEs
          </p>
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

      <main className="flex items-start justify-center bg-surface px-4 py-5 sm:px-6 sm:py-10 lg:items-center">
        <div className="w-full max-w-md">
          <h2 className="text-xl font-bold text-brand-950 sm:text-2xl">{mode === "signin" ? "Welcome back" : "Create your workspace"}</h2>
          <p className="mt-1 hidden text-sm text-muted sm:block">
            {mode === "signin"
              ? "Sign in to record and check today's deliveries."
              : "You'll be the owner. You can add your managers and staff next."}
          </p>

          <div role="tablist" aria-label="Sign in or create a workspace" className="mt-4 flex sm:mt-6 gap-1 rounded-xl bg-slate-200/60 p-1">
            {tab("signin", "Sign in")}
            {tab("register", "Create a workspace")}
          </div>

          {onTablet && <KitchenSignIn screen={kitchen} onSignedIn={onSignedIn} onUsePassword={() => setUsePassword(true)} onForgotten={() => setKitchen(null)} />}

          <form hidden={onTablet} onSubmit={(e) => void submit(e)} className="mt-4 space-y-3 sm:mt-6 sm:space-y-4">
            {mode === "register" && (
              <>
                <div>
                  <label className={labelClass} htmlFor="workspace">
                    Business name
                  </label>
                  <input id="workspace" required maxLength={80} autoComplete="organization" placeholder="e.g. Kopi Corner Sdn Bhd" className={inputClass} value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="display-name">
                      Your name
                    </label>
                    <input id="display-name" required maxLength={80} autoComplete="name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="email">
                      Email
                    </label>
                    <input id="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" autoCapitalize="none" placeholder="you@business.com" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                </div>
              </>
            )}
            <div>
              <label className={labelClass} htmlFor="username">
                {mode === "signin" ? "Username or email" : "Username"}
              </label>
              <input
                id="username"
                required
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                {...(mode === "register" ? { minLength: 3, maxLength: 32, pattern: USERNAME_PATTERN, title: USERNAME_HINT } : { maxLength: 254 })}
                aria-describedby={mode === "register" ? "username-hint" : undefined}
                className={inputClass}
                value={username}
                onChange={(e) => {
                  if (mode !== "register") return setUsername(e.target.value);
                  const cleaned = cleanUsername(e.target.value);
                  setUsername(cleaned.value);
                  setDropped(cleaned.removed);
                }}
              />
              {mode === "register" && <UsernameStatus check={usernameCheck} />}
              {mode === "register" && (
                <p id="username-hint" className={`mt-1 text-xs ${dropped ? "font-semibold text-amber-800" : "text-muted"}`} aria-live="polite">
                  {dropped ? "Spaces and symbols can't be used in a username, so they were left out. " : ""}
                  {USERNAME_HINT}
                </p>
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
              {mode === "register" && <p className="mt-1 text-xs text-muted">At least 8 characters.</p>}
            </div>
            <ErrorNote message={error} />
            <button type="submit" disabled={busy} className={`${primaryButton} relative w-full py-3 text-base`}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create workspace"}
              {mode === "signin" && <LastUsed method="password" on={lastSignIn()} />}
            </button>
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
          <SdgFooter className="mt-10" />
          <PolicyLinks className="mt-4" />
        </div>
      </main>
    </div>
  );
}
