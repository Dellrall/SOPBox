import { useEffect, useState } from "react";
import { api } from "./api";
import type { Product } from "./types";
import { Empty, ErrorNote, PageTitle, SuccessNote, cardClass, inputClass, primaryButton } from "./ui";

/** What was typed for one product: whole packs plus loose base units. */
type Draft = { packs: string; loose: string };

const largestPack = (p: Product) => p.pack_units.slice().sort((a, b) => b.base_qty - a.base_qty)[0];
const isCount = (text: string) => /^\d+$/.test(text.trim());
const cell = `${inputClass} w-20! px-2.5 py-2 text-sm`;

/** The counted total in base units, null when nothing was typed, NaN when something is not a whole number. */
function counted(p: Product, d: Draft | undefined): number | null {
  if (!d || (d.packs.trim() === "" && d.loose.trim() === "")) return null;
  const parts = [d.packs, d.loose].filter((t) => t.trim() !== "");
  if (!parts.every(isCount)) return NaN;
  const pack = largestPack(p);
  return (pack && d.packs.trim() ? Number(d.packs) * pack.base_qty : 0) + (d.loose.trim() ? Number(d.loose) : 0);
}

/** Managers count what is on the shelf; the count replaces the recorded stock and is logged. */
export default function StockCount() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .products()
      .then((all) => setProducts(all.filter((p) => !p.archived)))
      .catch((e: Error) => setError(e.message));
  }, []);

  const set = (id: number, patch: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [id]: { ...(all[id] ?? { packs: "", loose: "" }), ...patch } }));

  const entered = (products ?? []).map((p) => ({ p, total: counted(p, drafts[p.id]) })).filter((e) => e.total !== null);

  async function save() {
    setError("");
    setNotice("");
    const bad = entered.find((e) => Number.isNaN(e.total));
    if (bad) return setError(`${bad.p.name}: enter whole numbers only.`);
    if (entered.length === 0) return setError("Type a count for at least one product.");
    setBusy(true);
    try {
      const fresh = await api.countStock(entered.map((e) => ({ product_id: e.p.id, counted: e.total as number })));
      const changed = entered.filter((e) => e.total !== e.p.stock).length;
      setProducts(fresh);
      setDrafts({});
      setNotice(`Count saved for ${entered.length} ${entered.length === 1 ? "product" : "products"}. ${changed} stock ${changed === 1 ? "level" : "levels"} corrected.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle
        title="Stock count"
        subtitle="Count what is on the shelf. Your count replaces the recorded stock, and every correction goes into the activity log."
      />
      {notice && <SuccessNote>{notice}</SuccessNote>}
      <ErrorNote message={error} />
      {products?.length === 0 && <Empty>No products yet. Add them under Products & SOP.</Empty>}
      {products && products.length > 0 && (
        <section className={cardClass}>
          <p className="mb-3 text-sm text-muted">Leave a product empty to skip it.</p>
          <ul className="divide-y divide-line">
            {products.map((p) => {
              const pack = largestPack(p);
              const total = counted(p, drafts[p.id]);
              const diff = total === null || Number.isNaN(total) ? null : total - p.stock;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-muted">
                      Recorded: {p.stock} {p.base_unit}
                      {diff !== null && diff !== 0 && (
                        <span className={`ml-2 font-semibold ${diff < 0 ? "text-red-700" : "text-brand-700"}`}>
                          {diff > 0 ? `+${diff}` : diff} → {total} {p.base_unit}
                        </span>
                      )}
                      {diff === 0 && <span className="ml-2 font-semibold text-brand-700">matches</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {pack && (
                      <>
                        <input aria-label={`${p.name}: whole ${pack.unit}`} inputMode="numeric" placeholder="0" className={cell} value={drafts[p.id]?.packs ?? ""} onChange={(e) => set(p.id, { packs: e.target.value })} />
                        <span className="text-muted">{pack.unit} +</span>
                      </>
                    )}
                    <input aria-label={`${p.name}: ${pack ? "loose " : ""}${p.base_unit}`} inputMode="numeric" placeholder="0" className={cell} value={drafts[p.id]?.loose ?? ""} onChange={(e) => set(p.id, { loose: e.target.value })} />
                    <span className="text-muted">{p.base_unit}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <button className={`${primaryButton} mt-4`} disabled={busy} onClick={() => void save()}>
            Save count{entered.length > 0 && ` (${entered.length})`}
          </button>
        </section>
      )}
    </div>
  );
}
