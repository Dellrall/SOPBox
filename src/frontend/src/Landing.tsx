import {
  ArrowRight,
  BellRing,
  BookOpenCheck,
  ClipboardCheck,
  ClipboardList,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Thermometer,
  type LucideIcon,
} from "lucide-react";
import type { PublicPath } from "./App";
import DeliveryDemo from "./DeliveryDemo";
import { MascotFigure, type Action, type Who } from "./Mascot";
import { SDGS } from "./Sdg";
import { SiteFooter, SiteHeader, ctaButton, linkTo, usePageMeta } from "./Site";


const PRINCIPLES: { who: Who; action: Action; title: string; text: string }[] = [
  {
    who: "fish",
    action: "read",
    title: "AI reads",
    text: "A vision model reads the supplier's delivery order into lines: item, quantity and pack unit. Staff confirm every line before it counts.",
  },
  {
    who: "carrot",
    action: "probe",
    title: "Rules decide",
    text: "Pass or fail comes from your own rules, not the AI: the temperature range, the pack-to-unit conversion and the ordered quantity.",
  },
  {
    who: "cabbage",
    action: "write",
    title: "Humans approve",
    text: "Anything that fails waits for a manager to accept, reject or return it, with a reason. Stock only moves once they decide.",
  },
];

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Thermometer, title: "Temperature and pack checks", text: "Every line is checked against its range, pack size and the quantity still due on the order." },
  { icon: BellRing, title: "Manager approvals", text: "Failed deliveries wait for a manager, who hears on Telegram and decides with a reason." },
  { icon: BookOpenCheck, title: "SOP cards", text: "How to receive, store and handle each product, on any phone." },
  { icon: ClipboardList, title: "Stock counts", text: "Count each storage area; repeat shortfalls stand out with their value in RM." },
  { icon: ShoppingCart, title: "Orders from low stock", text: "Draft a purchase order sized to a week of use. Price rises are flagged on delivery." },
  { icon: Sparkles, title: "Ask the helper", text: "Ask what went missing, what to order or which prices went up." },
];

export default function Landing({ navigate }: { navigate: (to: PublicPath) => void }) {
  usePageMeta(
    "SOPBox · Smart receiving checks for F&B businesses",
    "SOPBox turns every supplier delivery into a quick phone check: AI reads the delivery order, rules check temperature, pack size and quantity, and managers approve failures. Built for food and beverage SMEs.",
  );
  const link = (to: PublicPath) => linkTo(navigate, to);

  return (
    <div className="min-h-screen bg-surface text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>

      <div className="hero-pattern text-white">
        <SiteHeader navigate={navigate} />

        <main id="main" className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-10 pt-2 sm:px-8 sm:pb-16 sm:pt-6 md:pt-14 md:grid-cols-[1.1fr_1fr] md:gap-8 lg:gap-12 lg:pb-24 lg:pt-12">
          <div>
            <h1 className="text-3xl font-extrabold leading-[1.1] sm:text-5xl md:text-4xl lg:text-6xl">
              Catch bad deliveries <span className="text-sand">at the door,</span> not in the kitchen.
            </h1>
            <p className="mt-3 max-w-xl text-white/75 sm:mt-5 sm:text-lg md:text-base lg:text-lg">
              SOPBox turns every supplier delivery into a one-minute check on a phone.{" "}
              <span className="hidden sm:inline">
                Wrong temperatures, short packs and missing items are stopped and sent to a manager before they reach your stock.
              </span>
            </p>
            <div className="mt-5 flex flex-wrap gap-3 sm:mt-8">
              <a {...link("/register")} className={ctaButton}>
                Create a workspace <ArrowRight aria-hidden className="h-4 w-4" />
              </a>
              <a {...link("/pricing")} className="inline-flex items-center rounded-xl px-5 py-3 sm:px-6 text-base font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">
                Pricing
              </a>
              <a href="#how" className="hidden items-center sm:inline-flex rounded-xl px-6 py-3 text-base font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">
                See how it works
              </a>
            </div>
          </div>
          {/* As wide as the phone, so the crew stays perched on it at every screen width. */}
          <div className="relative mx-auto w-full max-w-sm">
            <DeliveryDemo />
            {/* The crew, perched on top of the demo phone, cheering the check on. */}
            <div className="pointer-events-none absolute -top-14 right-6 sm:right-10">
              <MascotFigure who="crew" action="cheer" size={84} />
            </div>
          </div>
        </main>
      </div>

      <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-12 sm:px-8 sm:py-20">
        <h2 id="how-title" className="max-w-2xl text-2xl font-extrabold text-brand-950 sm:text-4xl">
          AI reads. Rules decide. Humans approve.
        </h2>
        <ol className="-mx-5 mt-6 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 sm:scroll-px-8 [scrollbar-width:none] sm:-mx-8 sm:mt-10 sm:px-8 md:mx-0 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0">
          {PRINCIPLES.map(({ who, action, title, text }, i) => (
            <li key={title} className="w-[78%] shrink-0 snap-start rounded-2xl border border-line bg-white p-4 shadow-sm sm:w-[45%] sm:p-6 md:w-auto">
              <div className="flex items-end justify-between gap-3">
                <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-brand-700">Step {i + 1}</span>
                {/* The crew acts out each step: reading, probing, signing off. */}
                <span className="flex h-16 w-16 items-end justify-center rounded-2xl bg-gradient-to-b from-brand-50 to-white sm:h-20 sm:w-20">
                  <MascotFigure who={who} action={action} size={64} />
                </span>
              </div>
              <h3 className="mt-2 text-lg font-bold text-brand-950 sm:mt-4">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="features" aria-labelledby="features-title" className="border-y border-line bg-white">
        <div className="mx-auto max-w-6xl scroll-mt-20 px-5 py-12 sm:px-8 sm:py-20">
          <h2 id="features-title" className="max-w-2xl text-2xl font-extrabold text-brand-950 sm:text-4xl">
            Everything a receiving check needs
          </h2>
          <ul className="mt-6 grid gap-x-8 gap-y-6 sm:mt-10 sm:gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
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

      <section id="sdgs" aria-labelledby="sdgs-title" className="mx-auto max-w-6xl scroll-mt-20 px-5 pt-12 sm:px-8 sm:pt-20">
        <h2 id="sdgs-title" className="max-w-2xl text-2xl font-extrabold text-brand-950 sm:text-4xl">
          Less food wasted, better work in small kitchens
        </h2>
        <ul className="mt-6 space-y-5 sm:mt-10">
          {SDGS.map((s) => (
            <li key={s.goal} className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-8">
              <div className="flex items-start gap-4 sm:items-center sm:gap-5">
                <img src={s.icon} alt={`SDG ${s.goal}: ${s.title}`} width={112} height={112} loading="lazy" className="h-16 w-16 shrink-0 rounded-md sm:h-28 sm:w-28" />
                <div>
                  <h3 className="text-lg font-bold text-brand-950 sm:text-xl">
                    Goal {s.goal}: {s.title}
                  </h3>
                  <p className="mt-1 text-sm text-muted sm:text-base">{s.statement}</p>
                  <a href={s.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline">
                    About Goal {s.goal} at un.org
                  </a>
                </div>
              </div>
              <ul className="-mx-5 mt-4 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 sm:scroll-px-8 [scrollbar-width:none] sm:-mx-8 sm:mt-6 sm:px-8 lg:mx-0 lg:grid lg:grid-cols-2 lg:gap-4 lg:overflow-visible lg:px-0">
                {s.targets.map((t) => (
                  <li key={t.id} className="w-[85%] shrink-0 snap-start rounded-xl bg-surface p-4 sm:w-[60%] lg:w-auto">
                    <p className="text-sm font-bold text-brand-950">Target {t.id}</p>
                    <blockquote cite={s.url} className="mt-1 text-sm italic leading-relaxed text-muted">
                      {t.text}
                    </blockquote>
                    <p className="mt-2 text-sm leading-relaxed text-ink">
                      <strong className="text-brand-700">How SOPBox helps:</strong> {t.fit}
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="cta-title" className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
        <div className="hero-pattern flex flex-col items-start gap-4 rounded-3xl px-6 py-8 text-white sm:gap-6 sm:px-12 sm:py-12 lg:flex-row lg:items-center">
          <span className="hidden sm:block">
            <MascotFigure who="cabbage" action="wave" size={88} />
          </span>
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
            <a {...link("/signin")} className="inline-flex items-center rounded-xl px-4 py-3 sm:px-6 text-base font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">
              Sign in
            </a>
          </div>
        </div>
      </section>

      <SiteFooter navigate={navigate} />
    </div>
  );
}
