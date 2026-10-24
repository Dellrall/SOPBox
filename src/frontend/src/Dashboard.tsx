import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Clock, PackageX, ScanLine, ThumbsUp, Truck, type LucideIcon } from "lucide-react";
import { api } from "./api";
import { DeliveriesChart, LowStockBars } from "./DashboardCharts";
import { useMascot } from "./Mascot";
import { LatestNotification } from "./Inbox";
import type { PageId } from "./App";
import type { DashboardSummary, Me, Notification, PurchaseOrder } from "./types";
import { Empty, ErrorNote, PageTitle, SectionTitle, StatusBadge, cardClass, panelClass, primaryButton, secondaryButton, when } from "./ui";

/** A number with what it counts and when ("today", "right now"); opens its page when it has one. */
function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  tone: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-brand-950">{value}</p>
        <p className="mt-1 text-xs text-muted">{hint}</p>
      </div>
      {/* Phones: no icon, so the words get the width. */}
      <span className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex ${tone}`}>
        <Icon aria-hidden className="h-5 w-5" />
      </span>
    </>
  );
  const className = `${cardClass} flex items-start justify-between gap-3 text-left`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} transition hover:border-brand-300 hover:shadow-md`}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

const dueText = (o: PurchaseOrder) => {
  if (!o.expected_date) return { text: "No delivery date set", late: false };
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
  const day = new Date(`${o.expected_date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (o.expected_date < today) return { text: `Overdue since ${day}`, late: true };
  return { text: o.expected_date === today ? "Due today" : `Due ${day}`, late: false };
};

/** Issued orders whose goods have not all arrived, soonest due first. */
function ComingIn({ orders, onOpen }: { orders: PurchaseOrder[]; onOpen: () => void }) {
  return (
    <ul className={`${panelClass} divide-y divide-line text-sm`}>
      {orders.slice(0, 5).map((o) => {
        const owed = o.lines.filter((l) => l.outstanding_base_qty > 0).length;
        const due = dueText(o);
        return (
          <li key={o.id}>
            <button type="button" onClick={onOpen} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink">{o.supplier}</span>
                <span className="block text-xs text-muted">
                  {o.reference} · {owed} {owed === 1 ? "line" : "lines"} still to come
                  {o.receiving_status === "partially_received" && " · part received"}
                </span>
              </span>
              <span className={`shrink-0 text-xs font-semibold ${due.late ? "text-red-700" : "text-slate-600"}`}>{due.text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Step({ done, title, children }: { done: boolean; title: string; children?: ReactNode }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex gap-3 py-3">
      <Icon aria-hidden className={`mt-0.5 h-5 w-5 shrink-0 ${done ? "text-brand-600" : "text-slate-300"}`} />
      <div className="flex-1">
        <p className={`font-semibold ${done ? "text-muted line-through" : "text-ink"}`}>
          {title}
          <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
        </p>
        {!done && children}
      </div>
    </li>
  );
}

export default function Dashboard({
  me,
  go,
  canStartReceive,
  canEditProducts,
  canViewRecords,
  canViewApprovals,
  canViewPurchasing,
  onOpenNotification,
}: {
  me: Me;
  go: (page: PageId) => void;
  canStartReceive: boolean;
  canEditProducts: boolean;
  canViewRecords: boolean;
  canViewApprovals: boolean;
  canViewPurchasing: boolean;
  onOpenNotification: (n: Notification) => void;
}) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [hasTeam, setHasTeam] = useState(false);
  const [error, setError] = useState("");
  const [coming, setComing] = useState<PurchaseOrder[] | null>(null);

  useEffect(() => {
    api
      .dashboard()
      .then(setData)
      .catch((e: Error) => setError(e.message));
    // Only the owner can list accounts, and only the owner sees the team step.
    if (me.role === "owner")
      api
        .users()
        .then((users) => setHasTeam(users.some((u) => u.role !== "owner")))
        .catch(() => setHasTeam(false));
    if (canViewPurchasing)
      api
        .purchaseOrders("issued")
        .then((orders) =>
          setComing(
            orders
              .filter((o) => o.receiving_status !== "fully_received")
              .sort((a, b) => (a.expected_date ?? "9999").localeCompare(b.expected_date ?? "9999")),
          ),
        )
        .catch(() => setComing(null));
  }, [me.role, canViewPurchasing]);

  const waiting = data?.pending_count ?? 0;
  const lowCount = data?.low_stock_products.length ?? 0;
  useMascot(
    !data
      ? null
      : waiting > 0
        ? { who: "carrot", action: "worry", text: `${waiting} ${waiting === 1 ? "delivery is" : "deliveries are"} waiting for a manager.`, to: canViewApprovals ? "approvals" : undefined }
        : lowCount > 0
          ? { who: "cabbage", action: "count", text: `${lowCount} ${lowCount === 1 ? "product is" : "products are"} below minimum. Time to order?`, to: canViewPurchasing ? "purchasing" : undefined }
          : data.delivery_count > 0
            ? { who: "crew", action: "cheer", text: "Nothing waiting and nothing low. Nice work!" }
            : { who: "cabbage", action: "wave", text: "Hi! Add your products, then check your first delivery." },
  );

  if (error) return <ErrorNote message={error} />;
  if (!data) return <p className="text-muted">Loading…</p>;

  const pending = data.pending_count;
  // Today's outcomes, from the chart's data, in the viewer's own calendar day.
  const today = { accepted: 0, refused: 0 };
  for (const a of data.recent_activity) {
    if (new Date(a.created_at).toDateString() !== new Date().toDateString()) continue;
    if (a.status === "accepted") today.accepted += 1;
    else if (a.status === "rejected" || a.status === "returned") today.refused += 1;
  }
  const low = data.low_stock_products;
  const firstName = me.display_name.split(/\s+/)[0];

  if (data.product_count === 0 || data.delivery_count === 0) {
    return (
      <div>
        <PageTitle title={`Welcome, ${firstName}`} subtitle={`Let's get ${me.workspace.name} ready for its first receiving check.`} />
        <section className={`${cardClass} max-w-2xl`}>
          <SectionTitle>Getting started</SectionTitle>
          <ol className="mt-2 divide-y divide-line">
            <Step done={data.product_count > 0} title="Add your products and their rules">
              <p className="mt-1 text-sm text-muted">
                {canEditProducts
                  ? "Categories carry the temperature they should arrive at; products carry pack sizes and the SOP."
                  : "Ask a manager to add the products you receive."}
              </p>
              {canEditProducts && (
                <button className={`${primaryButton} mt-3`} onClick={() => go("products")}>
                  Add products <ArrowRight aria-hidden className="h-4 w-4" />
                </button>
              )}
            </Step>
            {me.role === "owner" && (
              <Step done={hasTeam} title="Create accounts for your team">
                <p className="mt-1 text-sm text-muted">Staff receive deliveries; managers also approve failures.</p>
                <button className={`${secondaryButton} mt-3`} onClick={() => go("team")}>
                  Open Team
                </button>
              </Step>
            )}
            <Step done={data.delivery_count > 0} title="Record your first delivery">
              <p className="mt-1 text-sm text-muted">Photograph the supplier's order or type the lines, then check them.</p>
              {data.product_count > 0 && canStartReceive && (
                <button className={`${primaryButton} mt-3`} onClick={() => go("receive")}>
                  <ScanLine aria-hidden className="h-4 w-4" /> Start a receiving check
                </button>
              )}
            </Step>
          </ol>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Photo: Yanhao Fang on Unsplash (Unsplash License). */}
      <header className="relative overflow-hidden rounded-3xl bg-brand-950 text-white shadow-sm">
        <img
          src="/kitchen-1600.jpg"
          srcSet="/kitchen-800.jpg 800w, /kitchen-1600.jpg 1600w"
          sizes="(min-width: 1024px) 64rem, 100vw"
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-brand-950/95 via-brand-950/75 to-brand-950/20" />
        <div className="relative flex min-h-48 flex-col justify-end gap-4 p-6 sm:min-h-52 sm:flex-row sm:items-end sm:justify-between sm:p-8">
          <div>
            <p className="text-sm font-medium text-brand-200">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Good to see you, {firstName}</h1>
            <p className="mt-1 text-sm text-white/80">Today at {me.workspace.name}.</p>
          </div>
          {canStartReceive && (
            <button className={`${primaryButton} self-start bg-white! text-brand-800! hover:bg-brand-50! sm:self-auto`} onClick={() => go("receive")}>
              <ScanLine aria-hidden className="h-4 w-4" /> Start a receiving check
            </button>
          )}
        </div>
        <a
          href="https://unsplash.com/photos/chefs-working-in-a-busy-professional-kitchen-preparing-food-rHjzjwxDP2g"
          target="_blank"
          rel="noreferrer"
          className="absolute right-3 top-2 text-[10px] text-white/60 hover:text-white"
        >
          Photo: Yanhao Fang / Unsplash
        </a>
      </header>

      {canViewApprovals && pending > 0 && (
        <button
          onClick={() => go("approvals")}
          className="flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-amber-900 transition hover:bg-amber-100"
        >
          <AlertTriangle aria-hidden className="h-5 w-5 shrink-0" />
          <span className="flex-1 text-sm font-semibold">
            {pending} {pending === 1 ? "delivery is" : "deliveries are"} waiting for your decision
          </span>
          <ArrowRight aria-hidden className="h-4 w-4" />
        </button>
      )}

      <LatestNotification onOpen={onOpenNotification} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Waiting for a manager"
          value={pending}
          hint="On hold right now"
          icon={Clock}
          tone="bg-amber-50 text-amber-700"
          onClick={canViewApprovals ? () => go("approvals") : undefined}
        />
        <Stat
          label="Accepted today"
          value={today.accepted}
          hint={`${data.accepted_count} in total`}
          icon={ThumbsUp}
          tone="bg-emerald-50 text-emerald-700"
          onClick={canViewRecords ? () => go("records") : undefined}
        />
        <Stat
          label="Rejected or returned today"
          value={today.refused}
          hint={`${data.rejected_count + data.returned_count} in total`}
          icon={PackageX}
          tone="bg-red-50 text-red-700"
          onClick={canViewRecords ? () => go("records") : undefined}
        />
        <Stat
          label="Low-stock products"
          value={low.length}
          hint="Below minimum right now"
          icon={AlertTriangle}
          tone={low.length ? "bg-amber-50 text-amber-700" : "bg-brand-50 text-brand-700"}
          onClick={canViewPurchasing ? () => go("purchasing") : undefined}
        />
      </div>

      <DeliveriesChart activity={data.recent_activity} />

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-3">
          <div className="flex items-center justify-between">
            <SectionTitle>Recent deliveries</SectionTitle>
            {canViewRecords && (
              <button className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => go("records")}>
                View all
              </button>
            )}
          </div>
          <ul className={`${panelClass} divide-y divide-line`}>
            {data.recent_deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-ink">{d.supplier || "Unknown supplier"}</span>
                  <span className="block text-xs text-muted">
                    #{d.id}{d.purchase_order && ` · ${d.purchase_order}`} · {when(d.created_at)}
                  </span>
                </span>
                <StatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-3 lg:col-span-2">
          <SectionTitle>Low stock</SectionTitle>
          {low.length === 0 ? (
            <Empty>Nothing is below its minimum.</Empty>
          ) : (
            <LowStockBars products={low} />
          )}
          {coming && (
            <>
              <div className="flex items-center justify-between pt-3">
                <SectionTitle>
                  <span className="inline-flex items-center gap-2">
                    <Truck aria-hidden className="h-4 w-4 text-brand-700" /> Coming in
                  </span>
                </SectionTitle>
                <button className="text-sm font-semibold text-brand-700 hover:underline" onClick={() => go("purchasing")}>
                  View all
                </button>
              </div>
              {coming.length === 0 ? (
                <Empty>No issued orders are waiting for goods.</Empty>
              ) : (
                <ComingIn orders={coming} onOpen={() => go("purchasing")} />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
