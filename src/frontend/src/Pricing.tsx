import { useEffect, useState } from "react";
import { Check, ChevronDown, Heart, LifeBuoy, Minus, Palette } from "lucide-react";
import { api } from "./api";
import type { PublicPath } from "./App";
import { MascotFigure } from "./Mascot";
import { SiteFooter, SiteHeader, ctaButton, linkTo, usePageMeta } from "./Site";
import type { Pricing as PricingData } from "./types";
import { cardClass, primaryButton, secondaryButton } from "./ui";

/** A price from plans.py, or "TBC" while it is not decided. */
export const price = (p: PricingData | null, key: string) => {
  const value = p?.prices[key];
  return value == null ? "TBC" : `${p!.currency} ${value.toLocaleString()}`;
};

/** In this page a price not decided yet reads "Coming soon" rather than "TBC". */
const shown = (p: PricingData | null, key: string) => (p?.prices[key] == null ? "Coming soon" : price(p, key));

export type Tier = { name: string; tagline: string; items: string[] };
export const FREE: Tier = {
  name: "Free",
  tagline: "For a single store",
  items: [
    "One outlet, any number of storage areas",
    "Your whole team",
    "AI delivery-order reading",
    "Stock, transfers, counts and sales upload",
    "Two-step sign-in",
  ],
};
export const PRO: Tier = {
  name: "Pro",
  tagline: "For businesses with more than one outlet",
  items: [
    "Everything in Free",
    "More outlets, priced per outlet",
    "HQ and branch links",
    "Till API keys",
    "Add customization or priority support",
  ],
};
export const ENTERPRISE: Tier = {
  name: "Enterprise",
  tagline: "For groups and franchises",
  items: ["Everything in Pro", "Customization included", "Priority support included", "One price for your whole group"],
};

const COMPARE: [string, boolean | string, boolean | string, boolean | string][] = [
  ["Outlets", "1", "As many as you pay for", "Agreed with sales"],
  ["Team members", true, true, true],
  ["AI delivery-order reading", true, true, true],
  ["Rules, approvals and activity log", true, true, true],
  ["Stock, transfers, counts and sales", true, true, true],
  ["Download your data", true, true, true],
  ["HQ and branch links", false, true, true],
  ["Till API keys", false, true, true],
  ["Customization", false, "Add-on", true],
  ["Priority support", false, "Add-on", true],
];

const FAQ: [string, string][] = [
  [
    "Is the Free plan really free?",
    "Yes. One outlet with any number of storage areas, your whole team and every check, with no time limit and no card needed.",
  ],
  [
    "What counts as an outlet?",
    "A place you receive deliveries, such as a restaurant or a central kitchen. The first outlet is free; Pro is priced for each one after that.",
  ],
  ["Yearly or once for life?", "Pay for each extra outlet by the year, or once for as long as SOPBox runs. Add-ons work the same way."],
  [
    "What if a yearly plan runs out?",
    "Your workspace counts as Free again. Nothing is deleted, and what you already set up keeps working.",
  ],
  ["How do I pay?", "Send an upgrade request from Settings, Plan & billing. Our team contacts you and turns the plan on once it is paid."],
  [
    "What happens to my data?",
    "It stays yours: download it whenever you like, and closing a business deletes it after 30 days. Read the privacy page for the details.",
  ],
];

function Mark({ value }: { value: boolean | string }) {
  if (typeof value === "string") return <span className="text-ink">{value}</span>;
  return value ? (
    <Check aria-label="Included" className="mx-auto h-5 w-5 text-emerald-600" />
  ) : (
    <Minus aria-label="Not included" className="mx-auto h-5 w-5 text-slate-300" />
  );
}

function PlanCard({
  tier,
  amount,
  note,
  featured,
  peek,
  children,
}: {
  tier: Tier;
  amount: string;
  note: string;
  featured?: boolean;
  peek?: React.ReactNode; // a character peeking over the card's top edge
  children: React.ReactNode;
}) {
  return (
    <section
      className={`relative flex flex-col rounded-3xl bg-white p-6 shadow-sm ${featured ? "ring-2 ring-brand-600 shadow-lg shadow-brand-900/10" : "ring-1 ring-line"}`}
    >
      {featured && (
        <p className="absolute -top-3 left-6 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">Grow to more outlets</p>
      )}
      {peek && <div className="pointer-events-none absolute -top-11 right-5">{peek}</div>}
      <h2 className="text-xl font-bold text-ink">{tier.name}</h2>
      <p className="text-sm text-muted">{tier.tagline}</p>
      <p className="mt-5 min-h-[4.5rem]">
        <span className="block text-4xl font-extrabold tracking-tight text-ink">{amount}</span>
        <span className="text-sm text-muted">{note}</span>
      </p>
      <div className="mt-4">{children}</div>
      <ul className="mt-6 space-y-2.5 border-t border-line pt-6 text-sm">
        {tier.items.map((item) => (
          <li key={item} className="flex gap-2.5">
            <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The public pricing page: Free for one store, Pro per outlet, Enterprise through sales. */
export default function Pricing({ navigate, signedIn }: { navigate: (to: PublicPath) => void; signedIn: boolean }) {
  const [pricing, setPricing] = useState<PricingData | null>(null);
  usePageMeta(
    "Pricing · SOPBox",
    "SOPBox pricing: free for one store, Pro priced per extra outlet by the year or once for life, and Enterprise plans for groups. Add customization and priority support.",
  );

  useEffect(() => {
    api
      .pricing()
      .then(setPricing)
      .catch(() => setPricing(null));
  }, []);

  const wide = "w-full justify-center";
  const lifetime = pricing?.prices.pro_outlet_lifetime;
  return (
    <div className="min-h-screen bg-surface text-ink">
      <div className="hero-pattern pb-24 text-white sm:pb-28">
        <SiteHeader navigate={navigate} signedIn={signedIn} />
        <div className="mx-auto max-w-3xl px-5 pt-2 text-center sm:px-8 sm:pt-8">
          <h1 className="text-3xl font-extrabold leading-tight sm:text-5xl">Free for one store. Pay only as you grow.</h1>
          <p className="mx-auto mt-3 max-w-xl text-white/75 sm:mt-4 sm:text-lg">
            Every plan has the full receiving check: AI reading, your rules, manager approvals and the activity log. Pay per extra outlet,
            for a year or once for life.
          </p>
        </div>
      </div>

      <main id="main" className="mx-auto -mt-20 max-w-6xl space-y-16 px-5 pb-16 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-3">
          <PlanCard
            tier={FREE}
            amount={`${pricing?.currency ?? "RM"} 0`}
            note="forever, for one outlet"
            peek={<MascotFigure who="cabbage" action="wave" size={60} />}
          >
            {signedIn ? (
              <a href="/" className={`${secondaryButton} ${wide}`}>
                Open SOPBox
              </a>
            ) : (
              <a {...linkTo(navigate, "/register")} className={`${primaryButton} ${wide}`}>
                Create a free workspace
              </a>
            )}
          </PlanCard>
          <PlanCard
            tier={PRO}
            featured
            amount={shown(pricing, "pro_outlet_year")}
            note={
              lifetime == null ? "per extra outlet, a year" : `per extra outlet, a year, or ${price(pricing, "pro_outlet_lifetime")} once`
            }
          >
            <a href={signedIn ? "/settings#billing" : "/register"} className={`${primaryButton} ${wide}`}>
              {signedIn ? "Upgrade in Settings" : "Start free, upgrade later"}
            </a>
          </PlanCard>
          <PlanCard tier={ENTERPRISE} amount="Let's talk" note="one price for your whole group">
            <a {...linkTo(navigate, "/contact?topic=sales")} className={`${secondaryButton} ${wide}`}>
              Contact sales
            </a>
          </PlanCard>
        </div>

        <section aria-labelledby="addons" className="space-y-5">
          <div className="text-center">
            <h2 id="addons" className="text-2xl font-bold">
              Add-ons for Pro
            </h2>
            <p className="mt-1 text-muted">Pick what you need. Enterprise includes both.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className={`${cardClass} flex gap-4`}>
              <Palette aria-hidden className="h-8 w-8 shrink-0 text-brand-600" />
              <div>
                <h3 className="font-semibold">Customization</h3>
                <p className="mt-1 text-sm text-muted">Your own branding, fields and checks, SOP templates and reports.</p>
                <p className="mt-3 text-sm font-semibold">
                  {shown(pricing, "customization_year")}
                  {pricing?.prices.customization_year != null && " a year"}
                  {pricing?.prices.customization_lifetime != null && `, or ${price(pricing, "customization_lifetime")} once`}
                </p>
              </div>
            </div>
            <div className={`${cardClass} flex gap-4`}>
              <LifeBuoy aria-hidden className="h-8 w-8 shrink-0 text-brand-600" />
              <div>
                <h3 className="font-semibold">Priority support</h3>
                <p className="mt-1 text-sm text-muted">
                  Your questions answered first. Everyone else can still ask for help from Settings.
                </p>
                <p className="mt-3 text-sm font-semibold">
                  {shown(pricing, "priority_support_year")}
                  {pricing?.prices.priority_support_year != null && " a year"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="compare" className="space-y-5">
          <h2 id="compare" className="text-center text-2xl font-bold">
            Compare plans
          </h2>
          <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-line">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="p-4 font-semibold">
                    <span className="sr-only">Feature</span>
                  </th>
                  {["Free", "Pro", "Enterprise"].map((name) => (
                    <th key={name} scope="col" className="p-4 text-center font-semibold">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE.map(([feature, ...plans]) => (
                  <tr key={feature} className="border-b border-line last:border-0">
                    <th scope="row" className="p-4 text-left font-medium text-ink">
                      {feature}
                    </th>
                    {plans.map((value, i) => (
                      <td key={i} className="p-4 text-center">
                        <Mark value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="faq" className="mx-auto max-w-3xl space-y-5">
          <h2 id="faq" className="text-center text-2xl font-bold">
            Questions
          </h2>
          <div className="divide-y divide-line rounded-2xl bg-white ring-1 ring-line">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {q}
                  <ChevronDown aria-hidden className="h-5 w-5 shrink-0 text-muted transition group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-sm text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="hero-pattern flex flex-col items-center gap-5 rounded-3xl p-8 text-center text-white sm:flex-row sm:p-10 sm:text-left">
          <MascotFigure who="carrot" action="count" size={80} />
          <div className="flex-1">
            <h2 className="text-2xl font-bold">Not sure which plan fits?</h2>
            <p className="mt-2 text-white/75">Ask us anything, or tell sales about your outlets and we will suggest a plan.</p>
          </div>
          <a {...linkTo(navigate, "/contact")} className={ctaButton}>
            Contact us
          </a>
        </section>

        {pricing?.kofi_url && (
          <section className="flex flex-col items-center gap-4 rounded-3xl bg-rose-50 p-8 text-center ring-1 ring-rose-100 sm:flex-row sm:text-left">
            <Heart aria-hidden className="h-10 w-10 shrink-0 text-rose-600" />
            <p className="flex-1">
              <strong className="block text-lg">Like SOPBox?</strong>
              It is free for small stores. If it helps your business, you can support it with a donation.
            </p>
            <a href={pricing.kofi_url} target="_blank" rel="noopener noreferrer" className={secondaryButton}>
              Donate on Ko-fi
            </a>
          </section>
        )}
      </main>
      <SiteFooter navigate={navigate} />
    </div>
  );
}
