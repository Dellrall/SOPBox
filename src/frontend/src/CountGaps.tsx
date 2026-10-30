import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { api } from "./api";
import type { CountGap, CountInsights, GapExplanation } from "./types";
import { ErrorNote, secondaryButton } from "./ui";

const PATTERN: Record<CountGap["pattern"], { label: string; tone: string }> = {
  repeat: { label: "Short again", tone: "bg-red-50 text-red-800 ring-red-200" },
  one_off: { label: "One-off gap", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  over: { label: "More than expected", tone: "bg-sky-50 text-sky-800 ring-sky-200" },
};

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * A saved count's gaps: each product that did not match, how it counted before, and what to
 * check. The numbers are worked out on the server; the AI only reads them back in plain words.
 */
export function CountGaps({ stocktakeId }: { stocktakeId: number }) {
  const [found, setFound] = useState<CountInsights | null>(null);
  const [reading, setReading] = useState<GapExplanation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setFound(null);
    setReading(null);
    setError("");
    api.stocktakeInsights(stocktakeId).then(setFound).catch((e: Error) => setError(e.message));
  }, [stocktakeId]);

  async function explain() {
    setError("");
    setBusy(true);
    try {
      setReading(await api.explainStocktake(stocktakeId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!found) return <ErrorNote message={error} />;
  if (found.gaps.length === 0) return null;
  return (
    <section aria-label="What stands out" className="space-y-3 rounded-xl bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-brand-950">What stands out</h4>
        <button type="button" className={secondaryButton} disabled={busy} onClick={() => void explain()}>
          {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Sparkles aria-hidden className="h-4 w-4" />}
          {busy ? "Reading… (up to 3 min if the AI was asleep)" : reading ? "Explain again" : "Explain with AI"}
        </button>
      </div>

      {reading && (
        <div className="space-y-2 rounded-xl border border-brand-200 bg-white p-3 text-sm" aria-live="polite">
          <p className="text-ink">{reading.summary}</p>
          {reading.actions.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5 text-ink">
              {reading.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          )}
          <p className="text-xs text-muted">Written by AI from the numbers below. Check before acting on it.</p>
        </div>
      )}
      <ErrorNote message={error} />

      <ul className="space-y-2">
        {found.gaps.map((g) => (
          <li key={`${g.product_id}-${g.product_name}`} className="rounded-xl border border-line bg-white p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{g.product_name}</span>
              <span className={`tabular-nums font-semibold ${g.difference < 0 ? "text-red-700" : "text-sky-800"}`}>
                {signed(g.difference)} {g.base_unit}
              </span>
              {g.share !== null && <span className="text-muted">({Math.abs(Math.round(g.share * 100))}% of expected)</span>}
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${PATTERN[g.pattern].tone}`}>{PATTERN[g.pattern].label}</span>
            </div>
            {g.earlier.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                Earlier counts: <span className="tabular-nums">{g.earlier.map(signed).join(", ")}</span>
              </p>
            )}
            <p className="mt-1 text-muted">{g.hint}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
