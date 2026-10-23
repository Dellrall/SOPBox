import { useEffect, useState, type FormEvent } from "react";
import { BellRing, Camera, ClipboardCheck, ScrollText, ShieldCheck, Thermometer } from "lucide-react";
import { api } from "./api";
import type { PublicPath } from "./App";
import type { Me } from "./types";
import { ErrorNote, inputClass, labelClass, primaryButton } from "./ui";

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
  }, [mode]);
  const [workspace, setWorkspace] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
      className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
        mode === m ? "bg-white text-brand-950 shadow-sm" : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="hero-pattern relative flex flex-col justify-between overflow-hidden px-6 py-8 text-white sm:px-10 lg:min-h-screen lg:px-14 lg:py-12">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="flex w-fit items-center gap-3 rounded-xl"
        >
          <img src="/logo-128.webp" alt="" width={44} height={44} className="h-11 w-11 rounded-xl object-cover ring-2 ring-white/15" />
          <span className="text-xl font-bold">SOPBox</span>
          <span className="sr-only">: back to the welcome page</span>
        </a>

        <div className="my-10 max-w-xl lg:my-0">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-leaf ring-1 ring-white/15">
            <ShieldCheck aria-hidden className="h-3.5 w-3.5" /> For food &amp; beverage SMEs
          </p>
          <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl lg:text-5xl">
            Receiving checks that <span className="text-sand">catch problems at the door.</span>
          </h1>
          <p className="mt-4 max-w-lg text-base text-white/75 sm:text-lg">
            SOPBox turns every delivery into a quick, guided check on a phone, so wrong temperatures, short
            packs and missing items are stopped before they reach your kitchen.
          </p>
          <ul className="mt-8 hidden gap-5 sm:grid sm:grid-cols-2">
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

      <main className="flex items-start justify-center bg-surface px-4 py-10 sm:px-6 lg:items-center">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-bold text-brand-950">{mode === "signin" ? "Welcome back" : "Create your workspace"}</h2>
          <p className="mt-1 text-sm text-muted">
            {mode === "signin"
              ? "Sign in to record and check today's deliveries."
              : "You'll be the owner. You can add your managers and staff next."}
          </p>

          <div role="tablist" aria-label="Sign in or create a workspace" className="mt-6 flex gap-1 rounded-xl bg-slate-200/60 p-1">
            {tab("signin", "Sign in")}
            {tab("register", "Create a workspace")}
          </div>

          <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
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
                spellCheck={false}
                className={inputClass}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              {mode === "register" && (
                <p className="mt-1 text-xs text-muted">3 to 32 characters: letters, digits, dot, dash or underscore.</p>
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
            <button type="submit" disabled={busy} className={`${primaryButton} w-full py-3 text-base`}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create workspace"}
            </button>
          </form>
          {mode === "signin" && (
            <p className="mt-6 rounded-xl border border-line bg-white px-4 py-3 text-sm text-muted">
              <strong className="text-ink">Staff or manager?</strong> Your owner creates your account. Ask
              them for your username and password.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
