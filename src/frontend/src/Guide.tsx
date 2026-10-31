import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, X } from "lucide-react";
import { api } from "./api";
import type { PageId } from "./App";
import { MascotFigure, startTour } from "./Mascot";
import type { Me, Setup } from "./types";
import { cardClass, primaryButton, secondaryButton } from "./ui";

/**
 * The owner's setup checklist on the Dashboard. Each step ticks itself off from what the workspace
 * has, so work done elsewhere (another device, a manager) counts. "Show me" opens the page and the
 * helper talks it through there, ringing the part to use.
 */

type Step = {
  id: keyof Setup;
  title: string;
  why: string;
  page: PageId;
  /** The Settings tab to open, for Settings pages. */
  tab?: string;
  spot?: string;
  lines: string[];
};

export const SETUP_STEPS: Step[] = [
  {
    id: "outlet",
    title: "Name your outlet",
    why: "“Main outlet” is only a starting name. Change it to your shop's real name, e.g. Kopi Corner Setapak.",
    page: "settings",
    tab: "workspace",
    spot: "section:has(#outlet-new)",
    lines: [
      "This is Settings, Workspace. Your outlets (shops or kitchens) are listed here.",
      "1. Find Main outlet. 2. Tap the pencil beside it. 3. Type your shop's name and tap OK. That's it.",
      "Running more than one shop? Pro adds an outlet for each, and you see them all from one place.",
    ],
  },
  {
    id: "storage",
    title: "Set up your storage areas",
    why: "Where stock sits in the outlet: Store, Chiller, Freezer…",
    page: "categories",
    spot: '[aria-labelledby="storage-heading"]',
    lines: [
      "These are your storage areas. Every outlet starts with one called Store.",
      "Add the places you keep stock, like Chiller or Freezer, or rename Store.",
      "Deliveries, stock counts and transfers each say which area the stock is in.",
    ],
  },
  {
    id: "product",
    title: "Add your first product and its SOP",
    why: "What you buy, the temperature it must arrive at, and how to handle it.",
    page: "products",
    spot: '[data-guide="add-product"]',
    lines: [
      "Products are what you buy. Each one carries the rules a delivery is checked against.",
      "Tap Add product: pick a category, set the pack size and safe temperature, and write the SOP your team follows.",
      "Got a supplier price list? Import from a sheet adds many products at once.",
    ],
  },
  {
    id: "team",
    title: "Add your team",
    why: "Accounts for the people who receive deliveries and run each outlet.",
    page: "team",
    spot: "form:has(#u-name)",
    lines: [
      "Here you make accounts for the people who work with you.",
      "Staff receive deliveries. Managers also approve the deliveries that fail a check.",
      "Give each outlet a manager: they can then add their own staff and assistant managers.",
    ],
  },
  {
    id: "delivery",
    title: "Check your first delivery",
    why: "Photograph the supplier's delivery order and check each line as it arrives.",
    page: "receive",
    lines: [
      "This is the receiving check, for each delivery that arrives.",
      "Snap the supplier's delivery order and I'll read the lines for you, or type them in.",
      "Then check the temperature and each line. Anything that fails goes to a manager to decide.",
    ],
  },
];

const hiddenKey = (me: Me) => `sopbox-setup-hidden-${me.id}-${me.workspace.id}`;

function isHidden(me: Me) {
  try {
    return localStorage.getItem(hiddenKey(me)) === "1";
  } catch {
    return false;
  }
}

function setHidden(me: Me, hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(hiddenKey(me), "1");
    else localStorage.removeItem(hiddenKey(me));
  } catch {
    /* it just won't be remembered */
  }
}

/** Bring the checklist back on the Dashboard after it was closed. */
export const showSetupAgain = (me: Me) => setHidden(me, false);

/** Open a step's page with the helper talking it through. */
export function showStep(step: Step, go: (page: PageId) => void) {
  if (step.tab) window.history.replaceState(null, "", `${window.location.pathname}#${step.tab}`);
  startTour({ page: step.page, step: step.title, lines: step.lines, spot: step.spot });
  go(step.page);
}

/** Owner only. `canHide` is off on the first-run Dashboard, where it is the whole page. */
export function SetupChecklist({ me, go, canHide = true }: { me: Me; go: (page: PageId) => void; canHide?: boolean }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [hidden, hide] = useState(() => canHide && isHidden(me));

  useEffect(() => {
    api
      .setup()
      .then(setSetup)
      .catch(() => setSetup(null));
  }, []);

  if (!setup || hidden) return null;
  const done = SETUP_STEPS.filter((s) => setup[s.id]).length;
  const all = done === SETUP_STEPS.length;
  const next = SETUP_STEPS.find((s) => !setup[s.id]);
  const firstName = me.display_name.split(/\s+/)[0];
  const close = () => {
    setHidden(me, true);
    hide(true);
  };

  return (
    <section aria-labelledby="setup-title" className={`${cardClass} max-w-3xl space-y-4`}>
      <div className="flex items-start gap-3">
        <MascotFigure who={all ? "crew" : "cabbage"} action={all ? "cheer" : "wave"} size={56} />
        <div className="relative min-w-0 flex-1 rounded-2xl rounded-tl-sm bg-brand-50 px-3 py-2.5 text-sm text-ink ring-1 ring-brand-100">
          <h2 id="setup-title" className="font-bold text-brand-950">
            {all ? "All set up!" : `Let's set up ${me.workspace.name}`}
          </h2>
          <p className="mt-0.5">
            {all
              ? `Nice work, ${firstName}. Everything is ready. Find guides for every page under Help & guides.`
              : `Hi ${firstName}! Pick a step and tap Show me. I'll take you there and walk you through it.`}
          </p>
        </div>
        {canHide && (
          <button
            type="button"
            onClick={close}
            className="rounded-full p-1.5 text-muted hover:bg-slate-100 hover:text-ink"
            aria-label="Close the setup checklist"
            title="Close. Bring it back from Help & guides."
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold text-muted">
          {done} of {SETUP_STEPS.length} done
        </p>
        <div
          className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={SETUP_STEPS.length}
          aria-valuenow={done}
        >
          <div className="h-full rounded-full bg-brand-600 transition-all duration-500" style={{ width: `${(done / SETUP_STEPS.length) * 100}%` }} />
        </div>
      </div>
      <ol className="divide-y divide-line">
        {SETUP_STEPS.map((step) => {
          const ok = setup[step.id];
          const Icon = ok ? CheckCircle2 : Circle;
          return (
            <li key={step.id} className="flex flex-wrap items-center gap-3 py-3">
              <Icon aria-hidden className={`h-5 w-5 shrink-0 ${ok ? "text-brand-600" : "text-slate-300"}`} />
              <div className="min-w-0 flex-1 basis-48">
                <p className={`font-semibold ${ok ? "text-muted line-through" : "text-ink"}`}>
                  {step.title}
                  <span className="sr-only">{ok ? " (done)" : " (to do)"}</span>
                </p>
                {!ok && <p className="text-sm text-muted">{step.why}</p>}
              </div>
              {!ok && (
                <button
                  type="button"
                  className={step === next ? primaryButton : secondaryButton}
                  aria-label={`Show me: ${step.title}`}
                  onClick={() => showStep(step, go)}
                >
                  Show me <ArrowRight aria-hidden className="h-4 w-4" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
