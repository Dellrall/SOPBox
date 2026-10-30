import { Building2, Rocket } from "lucide-react";
import type { PublicPath } from "./App";
import { SETUP_STEPS } from "./Guide";
import { GUIDES, OUTLET_STEPS, PlanTiers } from "./Help";
import { MascotFigure } from "./Mascot";
import { SiteFooter, SiteHeader, ctaButton, linkTo, usePageMeta } from "./Site";
import { secondaryButton } from "./ui";

/**
 * The public docs: the same guides as Help & guides in the app, for anyone to read before or
 * after signing up. Keep the guide text in Help.tsx so the two never disagree.
 */
export default function Docs({ navigate, signedIn }: { navigate: (to: PublicPath) => void; signedIn: boolean }) {
  usePageMeta(
    "Docs · SOPBox",
    "How to use SOPBox: set up your outlet, products and team, check deliveries as they arrive, count stock, and run more than one outlet with outlet managers on Pro and Enterprise.",
  );
  const contents = [
    { id: "start", title: "Getting started" },
    ...GUIDES.map((g) => ({ id: g.page, title: g.title })),
    { id: "outlets", title: "Outlets and plans" },
  ];
  const heading = "flex items-center gap-3 text-xl font-bold text-brand-950";
  const badge = "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700";

  return (
    <div className="min-h-screen bg-surface text-ink">
      <div className="hero-pattern pb-24 text-white sm:pb-28">
        <SiteHeader navigate={navigate} signedIn={signedIn} />
        <div className="mx-auto max-w-3xl px-5 pt-2 text-center sm:px-8 sm:pt-8">
          <h1 className="text-3xl font-extrabold leading-tight sm:text-5xl">How to use SOPBox</h1>
          <p className="mx-auto mt-3 max-w-xl text-white/75 sm:mt-4 sm:text-lg">
            Set up your outlet, check every delivery as it arrives, keep stock right, and grow to more outlets.
          </p>
        </div>
      </div>

      <main id="main" className="mx-auto -mt-20 grid max-w-6xl gap-6 px-5 pb-16 sm:px-8 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="On this page" className="hidden self-start rounded-3xl bg-white p-5 ring-1 ring-line lg:sticky lg:top-6 lg:block">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">On this page</p>
          {contents.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="block rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-brand-50 hover:text-brand-700">
              {s.title}
            </a>
          ))}
        </nav>
        <article className="relative min-w-0 space-y-10 rounded-3xl bg-white p-6 shadow-lg shadow-brand-900/10 ring-1 ring-line sm:p-10">
          <div className="pointer-events-none absolute -top-12 right-6">
            <MascotFigure who="cabbage" action="read" size={64} />
          </div>
          <nav aria-label="Jump to" className="flex flex-wrap gap-2 lg:hidden">
            {contents.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-full px-3 py-1.5 text-sm font-medium text-brand-800 ring-1 ring-line hover:bg-brand-50">
                {s.title}
              </a>
            ))}
          </nav>

          <section id="start" aria-labelledby="start-title" className="scroll-mt-6 space-y-3">
            <h2 id="start-title" className={heading}>
              <span className={badge}>
                <Rocket aria-hidden className="h-5 w-5" />
              </span>
              Getting started
            </h2>
            <p className="text-slate-700">
              A new workspace has one outlet with one storage area. These five steps get it ready. In the app, the setup checklist on the
              Dashboard walks you through each one.
            </p>
            <ol className="list-decimal space-y-2 pl-5 text-slate-700">
              {SETUP_STEPS.map((s) => (
                <li key={s.id} className="pl-1">
                  <strong className="text-ink">{s.title}.</strong> {s.why}
                </li>
              ))}
            </ol>
            {signedIn ? (
              <a href="/" className={ctaButton}>
                Open SOPBox
              </a>
            ) : (
              <a {...linkTo(navigate, "/register")} className={ctaButton}>
                Create your free workspace
              </a>
            )}
          </section>

          {GUIDES.map((g) => (
            <section key={g.page} id={g.page} aria-labelledby={`${g.page}-title`} className="scroll-mt-6 space-y-3 border-t border-line pt-8">
              <h2 id={`${g.page}-title`} className={heading}>
                <span className={badge}>
                  <g.icon aria-hidden className="h-5 w-5" />
                </span>
                {g.title}
              </h2>
              <p className="text-slate-700">{g.what}</p>
              <ol className="list-decimal space-y-1.5 pl-5 text-slate-700">
                {g.how.map((h) => (
                  <li key={h} className="pl-1">
                    {h}
                  </li>
                ))}
              </ol>
            </section>
          ))}

          <section id="outlets" aria-labelledby="outlets-title" className="scroll-mt-6 space-y-4 border-t border-line pt-8">
            <h2 id="outlets-title" className={heading}>
              <span className={badge}>
                <Building2 aria-hidden className="h-5 w-5" />
              </span>
              Outlets and plans
            </h2>
            <p className="text-slate-700">
              An outlet is a place that receives deliveries: a restaurant, a shop or a central kitchen. Each one has its own storage areas,
              stock and team. Free covers one outlet; Pro and Enterprise add more.
            </p>
            <ol className="list-decimal space-y-1.5 pl-5 text-slate-700">
              {OUTLET_STEPS.map((s) => (
                <li key={s} className="pl-1">
                  {s}
                </li>
              ))}
            </ol>
            <PlanTiers />
            <div className="flex flex-wrap gap-2">
              <a {...linkTo(navigate, "/pricing")} className={ctaButton}>
                See pricing
              </a>
              <a {...linkTo(navigate, "/contact?topic=sales")} className={secondaryButton}>
                Talk to sales about Enterprise
              </a>
            </div>
          </section>

          <p className="border-t border-line pt-8 text-slate-700">
            Still have a question?{" "}
            <a {...linkTo(navigate, "/contact")} className="font-semibold text-brand-700 underline">
              Ask the SOPBox team
            </a>
            .
          </p>
        </article>
      </main>
      <SiteFooter navigate={navigate} />
    </div>
  );
}
