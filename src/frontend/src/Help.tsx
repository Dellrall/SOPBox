import { useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  ClipboardCheck,
  ClipboardList,
  History,
  Layers,
  LayoutDashboard,
  PackageSearch,
  ScanLine,
  Settings as SettingsIcon,
  ShoppingCart,
  Truck,
  Users,
  type LucideIcon,
  ListChecks,
  ChevronDown,
} from "lucide-react";
import type { PageId } from "./App";
import { SETUP_STEPS, showSetupAgain, showStep } from "./Guide";
import { MascotFigure } from "./Mascot";
import { ENTERPRISE, FREE, PRO } from "./Pricing";
import type { Me } from "./types";
import { PageTitle, cardClass, primaryButton, secondaryButton } from "./ui";

/** One page of the app: what it is for and how to do the usual things there. */
export type Guide = { page: PageId; title: string; icon: LucideIcon; what: string; how: string[] };

export const GUIDES: Guide[] = [
  {
    page: "dashboard",
    title: "Dashboard",
    icon: LayoutDashboard,
    what: "Today at a glance: deliveries waiting for a decision, products running low, price rises, and orders still to arrive.",
    how: [
      "Tap a number to open the list behind it.",
      "Start a receiving check straight from the top of the page, or from Receive in the middle of the bottom bar.",
      "Tap the sparkle button by the helper to ask what went missing, what to order or which prices went up.",
    ],
  },
  {
    page: "purchasing",
    title: "Purchase orders",
    icon: ShoppingCart,
    what: "What you ordered from each supplier and how much of it has arrived.",
    how: [
      "Create an order with the products and quantities, then issue it.",
      "When the goods arrive, tap Receive on the order: the receiving check starts with its lines filled in.",
      "Part deliveries are tracked until everything has arrived.",
      "Open an order and tap Print or save as PDF for a signed paper copy for your records.",
      "Draft from low stock: pick a supplier and the amounts cover a week of recent use plus each minimum. With 3 weeks of uploaded sales, next week's sales are forecast from their trend. Tap a line to see why.",
    ],
  },
  {
    page: "receive",
    title: "Receiving check",
    icon: ScanLine,
    what: "Check a delivery as it arrives, against each product's rules.",
    how: [
      "Photograph the supplier's delivery order: the lines are read for you. Or type them in.",
      "To pick a product fast, tap the barcode button next to it and point the camera at the pack.",
      "Pick the storage area the stock goes to.",
      "Enter the temperature and quantity of each line, and add photos of anything wrong.",
      "Add the price per unit from the invoice if you have it: SOPBox flags a price rise of 10% or more.",
      "Type the expiry date printed on the pack. Two dates in one delivery? Tap Split this line. Can't see it in a sealed box? Tick Can't see it yet and fill it in later on Expiry dates.",
      "Lines that pass are accepted and added to stock. Anything that fails goes to Approvals.",
    ],
  },
  {
    page: "approvals",
    title: "Approvals",
    icon: ClipboardCheck,
    what: "Deliveries that failed a check, waiting for a manager. Stock only counts once a delivery is accepted.",
    how: ["Open a delivery to see its readings and photos.", "Accept it, reject it, or return it to the supplier. Your name is recorded with the decision."],
  },
  {
    page: "records",
    title: "Order records",
    icon: Truck,
    what: "Every delivery received, with its readings, photos and outcome.",
    how: ["Search by supplier, PO, delivery number, product or person.", "Open one to see exactly what was checked, by whom and when."],
  },
  {
    page: "stocktake",
    title: "Stock Count",
    icon: ClipboardList,
    what: "Count what is on the shelf, storage area by storage area.",
    how: [
      "Choose the storage area, then count each product as whole bundles plus loose items.",
      "Leave a product blank if you did not count it. Enter 0 only when you counted none.",
      "Save the count: the difference from the expected stock shows up as a loss or a gain.",
      "Open a saved count: What stands out shows repeat shortfalls and their value in RM. Explain with AI suggests what to check.",
      "Tap Print / PDF on a saved count to keep a signed copy.",
    ],
  },
  {
    page: "stock",
    title: "Stock & sales",
    icon: ArrowLeftRight,
    what: "What each outlet and storage area holds, transfers between them, and sales.",
    how: [
      "Move stock between storage areas or outlets with a transfer. Tap Print / PDF on a transfer for a paper copy.",
      "Upload your till's sales so the next count shows only real losses.",
      "Sales by menu item: tap Read a report and pick a photo, PDF or sheet from any till, or paste the text. Products are matched by code or name; the AI suggests the rest or asks you a question. Check each line, answer, then Take off stock. Matches are remembered, so next time needs no AI.",
      "A till connected by API key that sends an unknown item waits under Till sales waiting for you: tap Finish.",
    ],
  },
  {
    page: "expiry",
    title: "Expiry dates",
    icon: CalendarClock,
    what: "Every batch received with its expiry date, where it is, and which supplier, delivery and order it came from.",
    how: [
      "Turn on Track expiry for a product in Products & SOP: each delivery then needs its date, and too few days left goes to Approvals.",
      "Each batch gets a lot code. Write it and the date on the box, or tap Print labels. New stock goes behind; the earliest date goes in front.",
      "Sales, counts and transfers use the earliest date first, so the list shows what should be left of each batch.",
      "Everyone at the outlet is told when a batch is about to expire and again when it has.",
      "Expired: take it off the shelf, tap Dispose and pick how. Food waste goes in its own bin; only best-before items still before their date can be donated.",
    ],
  },
  {
    page: "products",
    title: "Products & SOP",
    icon: PackageSearch,
    what: "What you buy, the rules each delivery is checked against, and how your team handles it.",
    how: [
      "Tap Add product: pick its category, set the pack size, the safe temperature and the minimum stock.",
      "Write the SOP: the steps your team follows when it arrives. The SOP writer can draft one for you.",
      "Add the barcode (type it or scan the pack) so staff can scan it when receiving.",
      "Import from a sheet adds many products at once from a supplier list.",
    ],
  },
  {
    page: "categories",
    title: "Categories & storage",
    icon: Layers,
    what: "Categories group products and set the temperature they arrive at. Storage areas are where stock sits in each outlet.",
    how: [
      "Add a category such as Chilled or Frozen, with its temperature range.",
      "Add storage areas such as Chiller or Freezer to each outlet. Use the pencil to rename and the bin to delete an empty one.",
    ],
  },
  {
    page: "team",
    title: "Team",
    icon: Users,
    what: "The accounts of the people who work with you, and what each one may do.",
    how: [
      "Tap Add a person to create an account.",
      "Owner: creates every account, makes managers and sets the outlet each person works at.",
      "Manager: looks after the staff at their outlet, adds staff and assistant managers, and can disable accounts.",
      "Assistant manager: adds and looks after staff at their outlet, but cannot disable anyone.",
      "Staff: receive deliveries and use the sections you give them under Section access.",
      "Last 30 days shows each person's jobs done on time, deliveries checked, checks failed and stock count gaps. It is plain counting, not AI.",
    ],
  },
  {
    page: "tasks",
    title: "Tasks",
    icon: ListChecks,
    what: "Checklists for every day, and for busy times or a new starter.",
    how: [
      "Jobs lists open orders, held deliveries and planned counts, and says what to do today: check an order is on the way the day before, get ready on the day.",
      "The week strip shows how many jobs fall on each day, and how many are yours. Tap a day to see only that day.",
      "Tap Take it when a job has no PIC (person in charge), or a big order has only one. Otherwise ask to take over, and a manager approves. A message confirms each change, with Undo.",
      "Each job has its own steps, written from the order: call the supplier, clear space, the temperature check for each category, packs and expiry. Tick them as you go.",
      "Open Tasks and tick each step as you do it. Your name shows next to it, and the list starts fresh each day.",
      "Every day lists open by themselves; lists under Only when needed (a busy day, a new starter) open with a tap.",
      "Managers: assign any job to anyone, plan a stock count for a day, and add lists or start from a ready-made one.",
    ],
  },
  {
    page: "activity",
    title: "Activity log",
    icon: History,
    what: "Every reading, decision, stock count and account change, newest first.",
    how: ["Filter by person or by kind of action to see who did what and when."],
  },
  {
    page: "settings",
    title: "Settings",
    icon: SettingsIcon,
    what: "Your profile, how you sign in and, for owners and managers, the workspace.",
    how: [
      "Security: turn on two-step sign-in, add a passkey, or link Google or Telegram.",
      "Workspace: the business name, outlets, HQ branches and kitchen tablets.",
      "Integrations: connect your till and your team's Telegram group.",
      "Data & privacy: download a copy of everything.",
    ],
  },
];

/** How a business with several outlets is run in SOPBox. */
export const OUTLET_STEPS = [
  "The owner adds and renames outlets under Settings, Workspace.",
  "On Team, the owner sets the outlet each person works at, and hires a manager for it.",
  "That manager adds their own staff and assistant managers, so the owner does not have to.",
  "Everyone starts at their own outlet. Switch outlets from the card at the top of the menu.",
];

/** Free, Pro and Enterprise side by side, Pro picked out. */
export function PlanTiers() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {[FREE, PRO, ENTERPRISE].map((t) => (
        <div key={t.name} className={`rounded-2xl p-4 ring-1 ${t === PRO ? "bg-brand-50 ring-brand-200" : "ring-line"}`}>
          <p className="font-bold text-brand-950">{t.name}</p>
          <p className="text-xs text-muted">{t.tagline}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {t.items.map((item) => (
              <li key={item} className="flex gap-1.5">
                <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Outlets and the plans that add more of them. */
function OutletsAndPlans({ me, go }: { me: Me; go: (page: PageId) => void }) {
  const manager = me.role !== "staff";
  return (
    <section id="guide-outlets" aria-labelledby="outlets-title" className={`${cardClass} space-y-4`}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Building2 aria-hidden className="h-5 w-5" />
        </span>
        <div>
          <h2 id="outlets-title" className="text-lg font-bold text-brand-950">
            Outlets and plans
          </h2>
          <p className="mt-1 text-sm text-muted">
            An outlet is a place that receives deliveries: a restaurant, a shop or a central kitchen. Each one has its own storage areas,
            stock and team.
          </p>
        </div>
      </div>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink">
        {OUTLET_STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <PlanTiers />
      <div className="flex flex-wrap gap-2">
        {manager && (
          <button
            type="button"
            className={primaryButton}
            onClick={() => {
              window.history.replaceState(null, "", `${window.location.pathname}#billing`);
              go("settings");
            }}
          >
            Upgrade to Pro <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
        )}
        <a href="/pricing" className={secondaryButton}>
          Compare plans
        </a>
        <a href="/contact?topic=sales" className={secondaryButton}>
          Ask about Enterprise
        </a>
      </div>
    </section>
  );
}

/** Help & guides: what each page is for and how to use it, the setup checklist again, and outlets and plans. */
export default function Help({ me, go, canOpen }: { me: Me; go: (page: PageId) => void; canOpen: (page: PageId) => boolean }) {
  const [restored, setRestored] = useState(false);
  const guides = GUIDES.filter((g) => canOpen(g.page));

  return (
    <div className="space-y-6">
      <PageTitle title="Help & guides" />
      {me.role === "owner" && (
        <section className={`${cardClass} flex flex-wrap items-center gap-3`}>
          <MascotFigure who="cabbage" action="wave" size={48} />
          <div className="min-w-0 flex-1 basis-56">
            <p className="font-semibold text-ink">Setup checklist</p>
            <p className="text-sm text-muted">The first steps for a new workspace, with the helper showing you each one.</p>
          </div>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => {
              showSetupAgain(me);
              setRestored(true);
              go("dashboard");
            }}
          >
            {restored ? "Shown on the Dashboard" : "Show it on the Dashboard"}
          </button>
        </section>
      )}
      {/* One row per page, opened with a tap: all of them open would fill a dozen phone screens. */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        {guides.map((g) => {
          const step = me.role === "owner" ? SETUP_STEPS.find((s) => s.page === g.page) : undefined;
          return (
            <details
              key={g.page}
              id={`guide-${g.page}`}
              open={window.location.hash === `#guide-${g.page}`}
              className={`${cardClass} group scroll-mt-4`}
            >
              <summary className="flex cursor-pointer list-none items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <g.icon aria-hidden className="h-5 w-5" />
                </span>
                <h2 className="min-w-0 flex-1 text-base font-bold text-brand-950">{g.title}</h2>
                <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted transition group-open:rotate-180" />
              </summary>
              <div className="mt-3 space-y-3">
                <p className="text-sm text-muted">{g.what}</p>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
                  {g.how.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-2">
                  {step && (
                    <button type="button" className={primaryButton} onClick={() => showStep(step, go)}>
                      Show me
                    </button>
                  )}
                  <button type="button" className={secondaryButton} onClick={() => go(g.page)}>
                    Open {g.title} <ArrowRight aria-hidden className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </details>
          );
        })}
      </div>
      <OutletsAndPlans me={me} go={go} />
      <p className="text-sm text-muted">
        Still stuck?{" "}
        <button
          type="button"
          className="font-semibold text-brand-700 underline"
          onClick={() => {
            window.history.replaceState(null, "", `${window.location.pathname}#help`);
            go("settings");
          }}
        >
          Ask the SOPBox team
        </button>
        .
      </p>
    </div>
  );
}
