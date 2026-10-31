import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ClipboardList, RefreshCw, X } from "lucide-react";
import type { Stocktake, StocktakeDetail } from "./types";
import { PrintButton } from "./Print";
import { Empty, SectionTitle, cardClass, panelClass, secondaryButton } from "./ui";

const PAGE = 10;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "2026-10-24" for a local calendar day, the same shape as a stocktake's count_date. */
export const keyOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export const dayTitle = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** A month grid; each day with entries gets a bubble that grows with how many. Shared with Delivery records. */
export function CountCalendar({
  perDay,
  picked,
  onPick,
  noun = ["count", "counts"],
}: {
  perDay: Map<string, number>;
  picked: string | null;
  onPick: (day: string | null) => void;
  /** What a day holds, singular and plural. */
  noun?: [string, string];
}) {
  const latest = [...perDay.keys()].sort().pop();
  const start = latest ? new Date(`${latest}T00:00:00`) : new Date();
  const [month, setMonth] = useState({ y: start.getFullYear(), m: start.getMonth() });

  const first = new Date(month.y, month.m, 1);
  const days = new Date(month.y, month.m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday first
  const keys = Array.from({ length: days }, (_, i) => keyOf(month.y, month.m, i + 1));
  const busiest = Math.max(1, ...keys.map((k) => perDay.get(k) ?? 0));
  const today = (() => {
    const t = new Date();
    return keyOf(t.getFullYear(), t.getMonth(), t.getDate());
  })();
  const shift = (by: number) => setMonth(({ y, m }) => ({ y: m + by < 0 ? y - 1 : m + by > 11 ? y + 1 : y, m: (m + by + 12) % 12 }));

  return (
    <div className={`${cardClass} h-fit`}>
      <div className="flex items-center justify-between">
        <button type="button" className="rounded-lg p-2 text-muted hover:bg-slate-100" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
        <p className="font-semibold text-brand-950" aria-live="polite">
          {first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </p>
        <button type="button" className="rounded-lg p-2 text-muted hover:bg-slate-100" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-muted" aria-hidden>
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1">{d.slice(0, 2)}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {keys.map((key, i) => {
          const n = perDay.get(key) ?? 0;
          const isPicked = picked === key;
          // Bubble from 55% to 100% of the cell, by this day's share of the month's busiest day.
          const size = n ? 55 + 45 * (n / busiest) : 0;
          return (
            <button
              key={key}
              type="button"
              disabled={n === 0}
              aria-pressed={isPicked}
              aria-label={`${dayTitle(key)}: ${n} ${n === 1 ? noun[0] : noun[1]}`}
              title={n ? `${n} ${n === 1 ? noun[0] : noun[1]}` : undefined}
              onClick={() => onPick(isPicked ? null : key)}
              className="relative flex aspect-square items-center justify-center text-sm disabled:cursor-default"
            >
              {n > 0 && (
                <span
                  aria-hidden
                  className={`absolute rounded-full transition ${isPicked ? "bg-brand-700" : "bg-brand-100 hover:bg-brand-200"}`}
                  style={{ width: `${size}%`, height: `${size}%` }}
                />
              )}
              <span
                className={`relative tabular-nums ${
                  isPicked ? "font-bold text-white" : n ? "font-semibold text-brand-900" : key === today ? "font-semibold text-ink underline" : "text-slate-400"
                }`}
              >
                {i + 1}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-brand-100" />
        Bigger bubble, more {noun[1]}. Tap a day to see only its {noun[1]}.
      </p>
    </div>
  );
}

/** Saved stocktakes as a timeline by day, with a calendar to jump to one day. Details open in place. */
export default function StocktakeHistory({
  history,
  selected,
  onOpen,
  onClose,
  onRefresh,
  children,
}: {
  history: Stocktake[];
  selected: StocktakeDetail | null;
  onOpen: (id: number) => void;
  onClose: () => void;
  onRefresh: () => void;
  /** The opened stocktake's lines, shown under its entry. */
  children?: ReactNode;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  const perDay = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of history) out.set(s.count_date, (out.get(s.count_date) ?? 0) + 1);
    return out;
  }, [history]);

  const list = picked ? history.filter((s) => s.count_date === picked) : history.slice(0, shown);
  const groups: { day: string; items: Stocktake[] }[] = [];
  for (const s of list) {
    if (groups[groups.length - 1]?.day !== s.count_date) groups.push({ day: s.count_date, items: [] });
    groups[groups.length - 1].items.push(s);
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <SectionTitle>Stocktake history</SectionTitle>
          <p className="mt-1 text-sm text-muted">Every saved count, newest first.</p>
        </div>
        <button type="button" className={secondaryButton} onClick={onRefresh}>
          <RefreshCw aria-hidden className="h-4 w-4" /> Refresh
        </button>
      </div>

      {history.length === 0 ? (
        <Empty>No stocktakes have been saved.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <CountCalendar perDay={perDay} picked={picked} onPick={setPicked} />

          <div className="space-y-4">
            {picked && (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-full bg-brand-50 px-3 py-1 font-semibold text-brand-800 ring-1 ring-brand-200">{dayTitle(picked)}</span>
                <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline" onClick={() => setPicked(null)}>
                  <X aria-hidden className="h-3.5 w-3.5" /> Show all days
                </button>
              </p>
            )}

            {groups.map((group) => (
              <div key={group.day}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{dayTitle(group.day)}</h3>
                <ol className="relative space-y-3 border-l-2 border-brand-100 pl-5">
                  {group.items.map((s) => {
                    const open = selected?.id === s.id;
                    return (
                      <li key={s.id} className="relative">
                        <span
                          aria-hidden
                          className={`absolute -left-[1.85rem] top-4 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-surface ${
                            s.changed_count ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          <ClipboardList className="h-3.5 w-3.5" />
                        </span>
                        <div className={panelClass}>
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => (open ? onClose() : onOpen(s.id))}
                            className="flex w-full items-start justify-between gap-3 rounded-2xl p-4 text-left hover:bg-slate-50"
                          >
                            <span className="min-w-0">
                              <span className="block font-semibold text-brand-950">
                                {s.reference}
                                <span className="ml-2 text-sm font-normal text-muted">{timeOf(s.created_at)}</span>
                              </span>
                              <span className="mt-0.5 block text-sm text-muted">
                                by {s.counted_by}
                                {s.storage && ` · ${s.storage}`}
                              </span>
                              <span className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{s.line_count} counted</span>
                                <span className={`rounded-full px-2 py-0.5 ${s.changed_count ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
                                  {s.changed_count ? `${s.changed_count} changed` : "All matched"}
                                </span>
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700">
                              {open ? "Hide" : "Details"}
                              <ChevronDown aria-hidden className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
                            </span>
                          </button>
                          {open && (
                            <div className="space-y-2 border-t border-line p-4">
                              {selected.notes && <p className="text-sm text-ink">{selected.notes}</p>}
                              {children}
                              <PrintButton
                                doc={() => ({
                                  title: "Stock count",
                                  reference: selected.reference,
                                  details: [
                                    ["Storage area", selected.storage ?? ""],
                                    ["Count date", selected.count_date],
                                    ["Counted by", selected.counted_by],
                                    ["Saved at", selected.created_at.slice(0, 16).replace("T", " ")],
                                    ["Products", String(selected.line_count)],
                                    ["Changed", String(selected.changed_count)],
                                  ],
                                  columns: ["Product", "Expected", "Counted", "Difference"],
                                  rows: selected.lines.map((l) => [
                                    l.product_name,
                                    `${l.expected_stock} ${l.base_unit}`,
                                    `${l.counted_stock} ${l.base_unit}`,
                                    `${l.difference > 0 ? "+" : ""}${l.difference} ${l.base_unit}`,
                                  ]),
                                  notes: selected.notes,
                                  sign: ["Counted by", "Checked by"],
                                })}
                              />
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}

            {!picked && shown < history.length && (
              <button type="button" className={`${secondaryButton} w-full`} onClick={() => setShown((n) => n + PAGE)}>
                Show {Math.min(PAGE, history.length - shown)} more ({history.length - shown} left)
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
