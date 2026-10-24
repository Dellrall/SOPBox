import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Clock, PackageX, ScanLine, ThumbsUp, type LucideIcon } from "lucide-react";
import { api } from "./api";
import type { PageId } from "./App";
import type { DashboardSummary, Me } from "./types";
import { Empty, ErrorNote, PageTitle, SectionTitle, StatusBadge, cardClass, panelClass, primaryButton, secondaryButton, when } from "./ui";

function Stat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: string }) {
  return (
    <div className={`${cardClass} flex items-start justify-between gap-3`}>
      <div>
        <p className="text-sm font-medium text-muted">{label}</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-brand-950">{value}</p>
      </div>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <Icon aria-hidden className="h-5 w-5" />
      </span>
    </div>
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
}: {
  me: Me;
  go: (page: PageId) => void;
  canStartReceive: boolean;
  canEditProducts: boolean;
  canViewRecords: boolean;
  canViewApprovals: boolean;
}) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .dashboard()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <p className="text-muted">Loading…</p>;

  const pending = data.pending_count;
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
              <Step done={false} title="Create accounts for your team">
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
      <PageTitle title={`Good to see you, ${firstName}`} subtitle={`Today at ${me.workspace.name}.`}>
        {canStartReceive && (
          <button className={primaryButton} onClick={() => go("receive")}>
            <ScanLine aria-hidden className="h-4 w-4" /> Start a receiving check
          </button>
        )}
      </PageTitle>

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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Waiting for a manager" value={pending} icon={Clock} tone="bg-amber-50 text-amber-700" />
        <Stat label="Accepted" value={data.accepted_count} icon={ThumbsUp} tone="bg-emerald-50 text-emerald-700" />
        <Stat label="Rejected or returned" value={data.rejected_count + data.returned_count} icon={PackageX} tone="bg-red-50 text-red-700" />
        <Stat label="Low-stock products" value={low.length} icon={AlertTriangle} tone={low.length ? "bg-amber-50 text-amber-700" : "bg-brand-50 text-brand-700"} />
      </div>

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
            <ul className={`${panelClass} divide-y divide-line text-sm`}>
              {low.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-5 py-3">
                  <span className="font-semibold">{p.name}</span>
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-600/20">
                    {p.stock} / {p.min_stock} {p.base_unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
