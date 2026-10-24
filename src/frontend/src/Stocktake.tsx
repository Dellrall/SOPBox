import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Eye, FileUp, RefreshCw, X } from "lucide-react";
import { api } from "./api";
import type { StocktakeDetail, StocktakePreviewLine, StocktakeProduct } from "./types";
import {
  Empty,
  ErrorNote,
  PageTitle,
  SectionTitle,
  SuccessNote,
  cardClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
  when,
} from "./ui";

const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const formatDifference = (value: number, unit: string) =>
  `${value > 0 ? "+" : ""}${value} ${unit}`;

/** What was typed for one product: whole bundles and loose base units. */
type Count = { bundles: string; loose: string };
type Bundled = Pick<StocktakeProduct, "base_unit" | "bundle_unit" | "bundle_qty">;

const isWhole = (text: string) => /^\d+$/.test(text.trim());
const blank = (text: string | undefined) => (text ?? "").trim() === "";

/** The counted total in base units: null when nothing was typed, NaN when it is not whole numbers. */
function totalOf(product: StocktakeProduct, count: Count | undefined): number | null {
  if (!count || (blank(count.bundles) && blank(count.loose))) return null;
  const typed = [count.bundles, count.loose].filter((t) => !blank(t));
  if (!typed.every(isWhole)) return NaN;
  const bundles = blank(count.bundles) ? 0 : Number(count.bundles);
  return bundles * (product.bundle_qty ?? 0) + (blank(count.loose) ? 0 : Number(count.loose));
}

/** A total split into whole bundles and loose units: always the fewest loose units. */
function split(total: number, product: Bundled): Count {
  if (!product.bundle_qty) return { bundles: "", loose: String(total) };
  return { bundles: String(Math.floor(total / product.bundle_qty)), loose: String(total % product.bundle_qty) };
}

/** "4 box + 3 pkt (43 pkt)" for bundled products, "43 pkt" otherwise. */
function formatQty(total: number, product: Bundled | undefined, unit: string): string {
  if (!product?.bundle_qty || !product.bundle_unit) return `${total} ${unit}`;
  const { bundles, loose } = split(total, product);
  const parts = [Number(bundles) ? `${bundles} ${product.bundle_unit}` : "", Number(loose) ? `${loose} ${unit}` : ""].filter(Boolean);
  return `${parts.join(" + ") || `0 ${unit}`}${Number(bundles) ? ` (${total} ${unit})` : ""}`;
}

export default function Stocktake({ canEdit }: { canEdit: boolean }) {
  const [products, setProducts] = useState<StocktakeProduct[]>([]);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.stocktakes>>>([]);
  const [counts, setCounts] = useState<Record<number, Count>>({});
  const [countDate, setCountDate] = useState(localDate());
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [selected, setSelected] = useState<StocktakeDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [catalogue, stocktakes] = await Promise.all([api.stocktakeProducts(), api.stocktakes()]);
      setProducts(catalogue);
      setHistory(stocktakes);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return products;
    return products.filter((product) =>
      `${product.name} ${product.category} ${product.base_unit}`.toLocaleLowerCase().includes(query),
    );
  }, [products, search]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const counted = products.filter((product) => totalOf(product, counts[product.id]) !== null);
  const invalidProduct = counted.find((product) => !Number.isSafeInteger(totalOf(product, counts[product.id])));

  // Products under their category, in the order the server sends them (by category, then name).
  const sections = useMemo(() => {
    const out: { category: string; items: StocktakeProduct[] }[] = [];
    for (const p of visibleProducts) {
      if (out[out.length - 1]?.category !== p.category) out.push({ category: p.category, items: [] });
      out[out.length - 1].items.push(p);
    }
    return out;
  }, [visibleProducts]);

  function setCount(productId: number, patch: Partial<Count>) {
    setReviewing(false);
    setNotice("");
    setCounts((current) => ({ ...current, [productId]: { ...(current[productId] ?? { bundles: "", loose: "" }), ...patch } }));
  }

  /** Loose units that make up whole bundles move into the bundle count. */
  function rollUp(product: StocktakeProduct) {
    const total = totalOf(product, counts[product.id]);
    if (!product.bundle_qty || total === null || !Number.isSafeInteger(total)) return;
    if (Number(counts[product.id]?.loose || 0) >= product.bundle_qty) setCount(product.id, split(total, product));
  }

  async function downloadTemplate() {
    setBusy(true);
    setError("");
    try {
      const blob = await api.stocktakeTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "stock-count-template.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    setReviewing(false);
    try {
      const preview = await api.previewStocktake(file);
      const next: Record<number, Count> = {};
      for (const line of preview.lines) {
        const product = byId.get(line.product_id);
        next[line.product_id] = product ? split(line.counted_stock, product) : { bundles: "", loose: String(line.counted_stock) };
      }
      setCounts(next);
      setNotice(`${preview.lines.length} counted products loaded. Review the quantities before saving.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const reviewLines: StocktakePreviewLine[] = counted.flatMap((product) => {
    const quantity = totalOf(product, counts[product.id]);
    if (quantity === null || !Number.isSafeInteger(quantity)) return [];
    return [
      {
        product_id: product.id,
        product_name: product.name,
        base_unit: product.base_unit,
        expected_stock: product.stock,
        counted_stock: quantity,
        difference: quantity - product.stock,
      },
    ];
  });

  async function saveStocktake() {
    if (invalidProduct || reviewLines.length === 0) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await api.createStocktake({
        count_date: countDate,
        notes: notes.trim(),
        lines: reviewLines.map(({ product_id, expected_stock, counted_stock }) => ({
          product_id,
          expected_stock,
          counted_stock,
        })),
      });
      setCounts({});
      setNotes("");
      setCountDate(localDate());
      setReviewing(false);
      setSelected(saved);
      setNotice(`${saved.reference} saved. ${saved.changed_count} stock balances changed.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function showDetails(id: number) {
    setError("");
    try {
      setSelected(await api.stocktake(id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const changeValue = (line: StocktakePreviewLine) =>
    line.difference === 0 ? "No change" : formatDifference(line.difference, line.base_unit);

  return (
    <div className="space-y-6">
      <PageTitle
        title="Stock Count"
        subtitle="Count each product as whole bundles plus loose items. Extra loose items are rolled into bundles. Blank counts stay unchanged; enter 0 only when you counted zero."
      >
        {canEdit && (
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => void downloadTemplate()}>
            <Download aria-hidden className="h-4 w-4" />
            Blank Excel sheet
          </button>
        )}
      </PageTitle>

      <ErrorNote message={error} />
      {notice && <SuccessNote>{notice}</SuccessNote>}

      {!canEdit && (
        <section className={`${cardClass} space-y-1`}>
          <SectionTitle>View-only access</SectionTitle>
          <p className="text-sm text-muted">You can review stocktake history, but cannot submit a count.</p>
        </section>
      )}

      {canEdit && (
        <section className={`${cardClass} space-y-4`}>
          <div>
            <SectionTitle>New stocktake</SectionTitle>
            <p className="mt-1 text-sm text-muted">Enter what is on the shelf. The system quantity is shown in the review step.</p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelClass} htmlFor="stocktake-date">Count date</label>
              <input
                id="stocktake-date"
                type="date"
                className={inputClass}
                value={countDate}
                onChange={(event) => {
                  setReviewing(false);
                  setCountDate(event.target.value);
                }}
              />
            </div>
            <div className="min-w-56 flex-1">
              <label className={labelClass} htmlFor="stocktake-search">Find a product</label>
              <input
                id="stocktake-search"
                className={inputClass}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search product or category"
              />
            </div>
            <label className={`${secondaryButton} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
              <FileUp aria-hidden className="h-4 w-4" />
              Upload count sheet
              <input
                className="sr-only"
                type="file"
                accept=".xlsx,.csv"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold">Bundles</th>
                  <th className="px-3 py-2 font-semibold">Loose</th>
                  <th className="px-3 py-2 font-semibold">In hand</th>
                </tr>
              </thead>
              {sections.map((section) => (
                <tbody key={section.category} className="divide-y divide-line bg-white">
                  <tr>
                    <th colSpan={4} scope="colgroup" className="bg-brand-700 px-3 py-1.5 text-center text-sm font-semibold text-white">
                      {section.category}
                    </th>
                  </tr>
                  {section.items.map((product) => {
                    const count = counts[product.id];
                    const total = totalOf(product, count);
                    return (
                      <tr key={product.id}>
                        <td className="px-3 py-2.5 font-medium text-ink">{product.name}</td>
                        <td className="px-3 py-2.5">
                          {product.bundle_unit ? (
                            <div className="flex items-center gap-2">
                              <input
                                aria-label={`Bundles of ${product.name}`}
                                className={`${inputClass} max-w-24`}
                                inputMode="numeric"
                                value={count?.bundles ?? ""}
                                onChange={(event) => setCount(product.id, { bundles: event.target.value })}
                              />
                              <span className="text-xs text-muted">
                                {product.bundle_unit} <span className="whitespace-nowrap">({product.bundle_qty} {product.base_unit})</span>
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted">No bundle size</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <input
                              aria-label={`Loose ${product.base_unit} of ${product.name}`}
                              className={`${inputClass} max-w-24`}
                              inputMode="numeric"
                              value={count?.loose ?? ""}
                              onChange={(event) => setCount(product.id, { loose: event.target.value })}
                              onBlur={() => rollUp(product)}
                            />
                            <span className="text-xs text-muted">{product.base_unit}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-sm">
                          {total === null ? (
                            <span className="text-muted">Not counted</span>
                          ) : Number.isSafeInteger(total) ? (
                            <span className="font-semibold text-ink">{formatQty(total, product, product.base_unit)}</span>
                          ) : (
                            <span className="text-red-700">Whole numbers only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
              {visibleProducts.length === 0 && (
                <tbody>
                  <tr>
                    <td colSpan={4} className="px-3 py-5 text-center text-muted">No products match this search.</td>
                  </tr>
                </tbody>
              )}
            </table>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <label className={labelClass} htmlFor="stocktake-notes">Notes <span className="font-normal text-muted">(optional)</span></label>
              <textarea
                id="stocktake-notes"
                rows={2}
                maxLength={1000}
                className={inputClass}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Reason for the count or any relevant notes"
              />
            </div>
            <button
              type="button"
              className={primaryButton}
              disabled={busy || counted.length === 0 || Boolean(invalidProduct)}
              onClick={() => setReviewing(true)}
            >
              Review {counted.length} {counted.length === 1 ? "count" : "counts"}
            </button>
          </div>

          {invalidProduct && (
            <ErrorNote message={`${invalidProduct.name}: enter whole numbers of 0 or more.`} />
          )}

          {reviewing && (
            <div className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SectionTitle>Review stock changes</SectionTitle>
                  <p className="mt-1 text-sm text-muted">Saving updates each product’s total stock and records the previous balance.</p>
                </div>
                <button className="rounded-lg p-1.5 text-muted hover:bg-white" aria-label="Close review" onClick={() => setReviewing(false)}>
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-line bg-white">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="border-b border-line text-xs uppercase text-muted">
                    <tr>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">System</th>
                      <th className="px-3 py-2">Counted</th>
                      <th className="px-3 py-2">Difference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {reviewLines.map((line) => (
                      <tr key={line.product_id}>
                        <td className="px-3 py-2 font-medium">{line.product_name}</td>
                        <td className="px-3 py-2">{formatQty(line.expected_stock, byId.get(line.product_id), line.base_unit)}</td>
                        <td className="px-3 py-2">{formatQty(line.counted_stock, byId.get(line.product_id), line.base_unit)}</td>
                        <td className={`px-3 py-2 font-semibold ${line.difference < 0 ? "text-red-700" : line.difference > 0 ? "text-emerald-700" : "text-muted"}`}>
                          {changeValue(line)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className={primaryButton} disabled={busy} onClick={() => void saveStocktake()}>
                {busy ? "Saving…" : "Confirm and save stocktake"}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <SectionTitle>Stocktake history</SectionTitle>
            <p className="mt-1 text-sm text-muted">Saved counts and stock adjustments, newest first.</p>
          </div>
          <button type="button" className={secondaryButton} onClick={() => void load()}>
            <RefreshCw aria-hidden className="h-4 w-4" /> Refresh
          </button>
        </div>
        {history.length === 0 ? (
          <Empty>No stocktakes have been saved.</Empty>
        ) : (
          <ul className={`${cardClass} divide-y divide-line`}>
            {history.map((stocktake) => (
              <li key={stocktake.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold text-brand-950">{stocktake.reference} · {stocktake.count_date}</p>
                  <p className="text-sm text-muted">
                    {stocktake.counted_by} · {stocktake.line_count} counted · {stocktake.changed_count} changed
                    {" · "}{when(stocktake.created_at)}
                  </p>
                </div>
                <button type="button" className={secondaryButton} onClick={() => void showDetails(stocktake.id)}>
                  <Eye aria-hidden className="h-4 w-4" /> Details
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <section className={`${cardClass} space-y-4`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SectionTitle>{selected.reference} · {selected.count_date}</SectionTitle>
              <p className="mt-1 text-sm text-muted">
                Counted by {selected.counted_by} · {selected.line_count} products · {when(selected.created_at)}
              </p>
              {selected.notes && <p className="mt-2 text-sm text-ink">{selected.notes}</p>}
            </div>
            <button className={secondaryButton} onClick={() => setSelected(null)}>Close</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">System</th>
                  <th className="py-2 pr-3">Counted</th>
                  <th className="py-2">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {selected.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="py-2 pr-3 font-medium">{line.product_name}</td>
                    <td className="py-2 pr-3">{formatQty(line.expected_stock, line.product_id === null ? undefined : byId.get(line.product_id), line.base_unit)}</td>
                    <td className="py-2 pr-3">{formatQty(line.counted_stock, line.product_id === null ? undefined : byId.get(line.product_id), line.base_unit)}</td>
                    <td className={`py-2 font-semibold ${line.difference < 0 ? "text-red-700" : line.difference > 0 ? "text-emerald-700" : "text-muted"}`}>
                      {formatDifference(line.difference, line.base_unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
