import { useEffect, type MouseEvent } from "react";
import {
  ArrowRight,
  BellRing,
  BookOpenCheck,
  Bot,
  ClipboardCheck,
  Gavel,
  History,
  PackageCheck,
  ShieldCheck,
  Smartphone,
  Thermometer,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { PublicPath } from "./App";
import DeliveryDemo from "./DeliveryDemo";

// Light green on deep green: dark text keeps it readable (contrast above 4.5:1).
const ctaButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-leaf px-6 py-3 text-base font-semibold text-brand-950 shadow-sm transition hover:bg-[#8cc93e] active:scale-[0.98]";

const PRINCIPLES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Bot,
    title: "AI reads",
    text: "A vision model reads the supplier's delivery order into lines: item, quantity and pack unit. Staff confirm every line before it counts.",
  },
  {
    icon: Gavel,
    title: "Rules decide",
    text: "Pass or fail comes from your own rules, not the AI: the temperature range, the pack-to-unit conversion and the ordered quantity.",
  },
  {
    icon: Users,
    title: "Humans approve",
    text: "Anything that fails waits for a manager to accept, reject or return it, with a reason. Stock only moves once they decide.",
  },
];

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Thermometer, title: "Temperature checks", text: "Ranges per category or per product, with the probe reading saved on every line." },
  { icon: PackageCheck, title: "Pack conversion", text: "1 bundle = 250 pieces. Deliveries are counted in base units, so short packs show up." },
  { icon: BookOpenCheck, title: "SOP cards and search", text: "How to receive, store and handle each product, searchable from any phone." },
  { icon: BellRing, title: "Telegram alerts", text: "Managers hear about failures straight away; staff hear the decision." },
  { icon: History, title: "Full audit log", text: "Who received, who decided, when, and every reading. Ready for an inspection." },
  { icon: ShieldCheck, title: "Roles and separate workspaces", text: "Owner, manager and staff accounts. Each business sees only its own data." },
];

export default function Landing({ navigate }: { navigate: (to: PublicPath) => void }) {
  useEffect(() => {
    document.title = "SOPBox · Smart receiving checks for F&B businesses";
  }, []);

  // Real links (crawlable, open in a new tab) that switch pages without a reload.
  const link = (to: PublicPath) => ({
    href: to,
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
    },
  });

  return (
    <div className="min-h-screen bg-surface text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>

      <div className="hero-pattern text-white">
        <header className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-5 sm:px-8">
          <img src="/logo-128.webp" alt="" width={40} height={40} className="h-10 w-10 rounded-xl ring-2 ring-white/15" />
          <span className="text-lg font-bold">SOPBox</span>
          <nav aria-label="Site" className="ml-auto flex items-center gap-1 sm:gap-2">
            <a href="#how" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-white/80 hover:text-white sm:block">
              How it works
            </a>
            <a href="#features" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-white/80 hover:text-white sm:block">
              Features
            </a>
            <a {...link("/signin")} className="rounded-lg px-3 py-2 text-sm font-semibold text-white hover:bg-white/10">
              Sign in
            </a>
          </nav>
        </header>

        <main id="main" className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-12">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-leaf ring-1 ring-white/15">
              <ShieldCheck aria-hidden className="h-3.5 w-3.5" /> For food &amp; beverage SMEs
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.1] sm:text-5xl lg:text-6xl">
              Catch bad deliveries <span className="text-sand">at the door,</span> not in the kitchen.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/75">
              SOPBox turns every supplier delivery into a one-minute check on a phone. Wrong temperatures,
              short packs and missing items are stopped and sent to a manager before they reach your stock.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a {...link("/register")} className={ctaButton}>
                Create a workspace <ArrowRight aria-hidden className="h-4 w-4" />
              </a>
              <a href="#how" className="inline-flex items-center rounded-xl px-6 py-3 text-base font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">
                See how it works
              </a>
            </div>
            <p className="mt-4 text-sm text-white/60">Set up in minutes. Your team signs in with accounts you create.</p>
          </div>
          <DeliveryDemo />
        </main>
      </div>

      <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-20 sm:px-8">
        <p className="text-sm font-bold uppercase tracking-wider text-brand-600">How it works</p>
        <h2 id="how-title" className="mt-2 max-w-2xl text-3xl font-extrabold text-brand-950 sm:text-4xl">
          AI reads. Rules decide. Humans approve.
        </h2>
        <p className="mt-4 max-w-2xl text-muted">
          The AI only reads the paperwork. Whether a delivery passes is decided by rules you set, and
          anything that fails is decided by a person. So it never "guesses" a delivery through.
        </p>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {PRINCIPLES.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="rounded-2xl border border-line bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <Icon aria-hidden className="h-5 w-5" />
                </span>
                <span className="text-sm font-bold text-muted">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-brand-950">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="features" aria-labelledby="features-title" className="border-y border-line bg-white">
        <div className="mx-auto max-w-6xl scroll-mt-6 px-5 py-20 sm:px-8">
          <p className="text-sm font-bold uppercase tracking-wider text-brand-600">Features</p>
          <h2 id="features-title" className="mt-2 max-w-2xl text-3xl font-extrabold text-brand-950 sm:text-4xl">
            Everything a receiving check needs, on the phone your staff already carry
          </h2>
          <ul className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-950 text-leaf">
                  <Icon aria-hidden className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-bold text-brand-950">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="cta-title" className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="hero-pattern flex flex-col items-start gap-6 rounded-3xl px-8 py-12 text-white sm:px-12 lg:flex-row lg:items-center">
          <div className="flex-1">
            <h2 id="cta-title" className="text-2xl font-extrabold sm:text-3xl">
              Run your next delivery through SOPBox
            </h2>
            <p className="mt-2 max-w-xl text-white/75">
              Create a workspace, add the products you buy with their temperature and pack rules, and hand
              your staff a phone.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a {...link("/register")} className={ctaButton}>
              Create a workspace
            </a>
            <a {...link("/signin")} className="inline-flex items-center rounded-xl px-6 py-3 text-base font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">
              Sign in
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-8 text-sm text-muted sm:px-8">
          <span className="flex items-center gap-2 font-semibold text-brand-950">
            <ClipboardCheck aria-hidden className="h-4 w-4 text-brand-600" /> SOPBox
          </span>
          <span className="flex items-center gap-2">
            <Smartphone aria-hidden className="h-4 w-4" /> Works in any phone browser, no app to install
          </span>
          <span className="sm:ml-auto">AI runs on RunPod. Rules and approvals stay in your hands.</span>
        </div>
      </footer>
    </div>
  );
}
