import { useState } from "react";
import type { DashboardSummary, DeliveryStatus } from "./types";
import { panelClass } from "./ui";

/** Outcome colors: the app's status colors, each also named in the legend, tooltip and table. */
const OUTCOMES = [
  { key: "accepted", label: "Accepted", color: "#059669" },
  { key: "waiting", label: "Waiting", color: "#f59e0b" },
  { key: "refused", label: "Rejected or returned", color: "#dc2626" },
] as const;
type Outcome = (typeof OUTCOMES)[number]["key"];

const outcomeOf = (status: DeliveryStatus): Outcome =>
  status === "accepted" ? "accepted" : status === "pending_approval" ? "waiting" : "refused";

const DAYS = 14;
const MIN_DAYS = 7;

type Day = { label: string; short: string; counts: Record<Outcome, number>; total: number };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Calendar days in the viewer's time zone, oldest first, with each day's outcomes. From the first
 *  delivery in the window, so a new workspace is not mostly empty days: at least 7, at most 14. */
function lastDays(activity: DashboardSummary["recent_activity"]): Day[] {
  const days: Day[] = [];
  const index = new Map<string, Day>();
  const today = new Date();
  const first = Math.min(today.getTime(), ...activity.map((a) => startOfDay(new Date(a.created_at)).getTime()));
  const span = Math.min(DAYS, Math.max(MIN_DAYS, Math.round((startOfDay(today).getTime() - first) / 86_400_000) + 1));
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const day: Day = {
      label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
      short: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      counts: { accepted: 0, waiting: 0, refused: 0 },
      total: 0,
    };
    days.push(day);
    index.set(d.toDateString(), day);
  }
  for (const a of activity) {
    const day = index.get(new Date(a.created_at).toDateString());
    if (!day) continue;
    day.counts[outcomeOf(a.status)] += 1;
    day.total += 1;
  }
  return days;
}

/** Stacked bars: deliveries checked each day, split by what happened to them. */
export function DeliveriesChart({ activity }: { activity: DashboardSummary["recent_activity"] }) {
  const days = lastDays(activity);
  const n = days.length;
  const [hover, setHover] = useState<number | null>(null);
  const total = days.reduce((n, d) => n + d.total, 0);
  const max = Math.max(1, ...days.map((d) => d.total));
  const top = max <= 4 ? max : Math.ceil(max / 2) * 2; // a round axis top
  const shown = hover === null ? null : days[hover];

  return (
    <section className={`${panelClass} p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-brand-950">Deliveries checked, last {n} days</h2>
        <p className="text-sm text-muted">{total} in total</p>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-hidden>
        {OUTCOMES.map((o) => (
          <li key={o.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: o.color }} /> {o.label}
          </li>
        ))}
      </ul>
      <div className="relative mt-4 flex gap-2" aria-hidden onMouseLeave={() => setHover(null)}>
        {/* y axis */}
        <div className="flex h-24 flex-col sm:h-40 justify-between text-right text-[11px] leading-none tabular-nums text-slate-500">
          <span className="-translate-y-1/2">{top}</span>
          <span>{top / 2}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div className="relative flex-1">
          <div className="absolute inset-x-0 top-0 h-24 border-y sm:h-40 border-[#e7e9e6]">
            <div className="absolute inset-x-0 top-1/2 border-t border-[#e7e9e6]" />
          </div>
          <div className="relative grid h-24 sm:h-40" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {days.map((d, i) => (
              <div
                key={d.label}
                className={`flex h-full flex-col-reverse items-center gap-0.5 rounded-sm ${hover === i ? "bg-slate-100/70" : ""}`}
                onMouseEnter={() => setHover(i)}
              >
                {OUTCOMES.map((o) =>
                  d.counts[o.key] ? (
                    <div
                      key={o.key}
                      className="w-3/5 max-w-7 rounded-[3px]"
                      style={{ background: o.color, height: `calc(${(d.counts[o.key] / top) * 100}% - 2px)` }}
                    />
                  ) : null,
                )}
              </div>
            ))}
          </div>
          <div className="mt-1.5 grid text-center text-[11px] text-slate-500" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {days.map((d, i) => (
              <span key={d.label} className="whitespace-nowrap">
                {(n - 1 - i) % (n > MIN_DAYS ? 3 : 1) === 0 ? d.short : ""}
              </span>
            ))}
          </div>
          {shown && hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 w-44 rounded-lg border border-line bg-white p-2.5 text-xs shadow-lg"
              style={hover < n / 2 ? { left: `${((hover + 1) / n) * 100}%` } : { right: `${100 - (hover / n) * 100}%` }}
            >
              <p className="font-semibold text-ink">{shown.label}</p>
              {OUTCOMES.map((o) => (
                <p key={o.key} className="mt-0.5 flex items-center justify-between gap-2 text-slate-600">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: o.color }} />{o.label}</span>
                  <span className="font-semibold tabular-nums text-ink">{shown.counts[o.key]}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* A table can outgrow an sr-only box, so the wrapper is what gets hidden. */}
      <div className="sr-only">
      <table>
        <caption>Deliveries per day</caption>
        <thead><tr><th>Day</th>{OUTCOMES.map((o) => <th key={o.key}>{o.label}</th>)}</tr></thead>
        <tbody>{days.map((d) => <tr key={d.label}><td>{d.label}</td>{OUTCOMES.map((o) => <td key={o.key}>{d.counts[o.key]}</td>)}</tr>)}</tbody>
      </table>
      </div>
    </section>
  );
}

/** One bar per low-stock product: how much of its minimum is on hand. */
export function LowStockBars({ products }: { products: DashboardSummary["low_stock_products"] }) {
  return (
    <ul className={`${panelClass} divide-y divide-line text-sm`}>
      {products.map((p) => {
        const share = p.min_stock > 0 ? Math.min(1, Math.max(0, p.stock / p.min_stock)) : 0;
        return (
          <li key={p.id} className="px-5 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{p.name}</span>
              <span className="text-xs font-semibold tabular-nums text-amber-800">
                {p.stock} / {p.min_stock} {p.base_unit}
              </span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
              role="meter"
              aria-label={`${p.name} stock`}
              aria-valuemin={0}
              aria-valuemax={p.min_stock}
              aria-valuenow={Math.max(0, p.stock)}
            >
              <div className={`h-full rounded-full ${share < 0.25 ? "bg-red-600" : "bg-amber-500"}`} style={{ width: `${Math.max(share * 100, 2)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
