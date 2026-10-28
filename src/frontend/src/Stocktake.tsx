import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, FileUp, X } from "lucide-react";
import { api } from "./api";
import StocktakeHistory from "./StocktakeHistory";
import { StorageSelect, firstStorageId, useStorages } from "./StorageSelect";
import { useMascot } from "./Mascot";
import type { StocktakeDetail, StocktakeLine, StocktakePreviewLine, StocktakeProduct } from "./types";
import {
  ErrorNote,
  PageTitle,
  SectionTitle,
  SuccessNote,
  cardClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./ui";

const EXPAND_KEY = "sopbox-stocktake-expanded";

/** Settings choice, kept on this device: start a stock count with every category open. */
export function stocktakeStartsExpanded(): boolean {
  try {
    return localStorage.getItem(EXPAND_KEY) === "1";
  } catch {
    return false;
  }
}

export function setStocktakeStartsExpanded(expanded: boolean) {
  try {
    localStorage.setItem(EXPAND_KEY, expanded ? "1" : "0");
  } catch {
    /* storage blocked: the default (folded) applies */
  }
}

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

type ChangeLine = Omit<StocktakeLine, "id"> & { key: number };

/** System, counted and difference per product: a row on wide screens, a small card on phones. */
function ChangeRows({ lines, products }: { lines: ChangeLine[]; products: Map<number, Bundled> }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-white text-sm">
      <li className="hidden grid-cols-[minmax(0,1.4fr)_1fr_1fr_8rem] gap-3 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
        <span>Product</span>
        <span>System</span>
        <span>Counted</span>
        <span>Difference</span>
      </li>
      {lines.map((line) => {
        const product = line.product_id === null ? undefined : products.get(line.product_id);
        const tone = line.difference < 0 ? "text-red-700" : line.difference > 0 ? "text-emerald-700" : "text-muted";
        return (
          <li key={line.key} className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 md:grid-cols-[minmax(0,1.4fr)_1fr_1fr_8rem]">
            <span className="font-medium text-ink">{line.product_name}</span>
            <span className={`text-right font-semibold md:order-last md:text-left ${tone}`}>
              {line.difference === 0 ? "No change" : formatDifference(line.difference, line.base_unit)}
            </span>
            <span className="text-slate-600">
              <span className="text-xs text-muted md:hidden">System </span>
              {formatQty(line.expected_stock, product, line.base_unit)}
            </span>
            <span className="text-right text-slate-600 md:text-left">
              <span className="text-xs text-muted md:hidden">Counted </span>
              {formatQty(line.counted_stock, product, line.base_unit)}
            </span>
          </li>
        );
      })}
    </ul>
  );
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
  // Categories open for counting. They start folded so a long catalogue stays readable, unless
  // the person turned that off in Settings (null: not touched yet). A search shows every match.
  const [opened, setOpened] = useState<Set<string> | null>(null);
  // The storage area being counted; its stock is the system quantity in the review.
  const storages = useStorages();
  const [picked, setPicked] = useState<number | null>(null);
  const storageId = picked ?? firstStorageId(storages);

  const load = useCallback(async () => {
    try {
      const [catalogue, stocktakes] = await Promise.all([
        api.stocktakeProducts(storageId ?? undefined),
        api.stocktakes(),
      ]);
      setProducts(catalogue);
      setHistory(stocktakes);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [storageId]);

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
  const [startExpanded] = useState(stocktakeStartsExpanded);
  const isOpen = (category: string) => (opened ? opened.has(category) : startExpanded);

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
      const preview = await api.previewStocktake(file, storageId ?? undefined);
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
        storage_id: storageId,
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

  useMascot(
    busy && reviewing
      ? { who: "cabbage", action: "carry", text: `Saving ${reviewLines.length} counts and updating stock…` }
      : notice.includes("saved")
        ? { who: "crew", action: "cheer", text: notice }
        : reviewing
          ? { who: "fish", action: "read", text: "Check the differences before you save. Red means less on the shelf than the system thinks." }
          : counted.length > 0
            ? { who: "cabbage", action: "count", text: `Counted ${counted.length} of ${products.length} products.`, progress: counted.length / Math.max(1, products.length) }
            : null,
  );

  return (
    <div className="space-y-6">
      <PageTitle
        title="Stock Count"
        subtitle="Count each product as whole bundles plus loose items. Extra loose items are rolled into bundles. Blank counts stay unchanged; enter 0 only when you counted zero."
      >
        {canEdit && (
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => void downloadTemplate()}>
            <Download aria-hidden className="h-4 w-4" />
            Stock Count Template
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
            {storages.length > 1 && (
              <StorageSelect
                id="stocktake-storage"
                label="Storage area counted"
                storages={storages}
                value={storageId}
                onChange={(id) => {
                  setPicked(id);
                  setCounts({});
                  setReviewing(false);
                }}
              />
            )}
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

          {sections.length > 1 && !search.trim() && (
            <div className="flex flex-wrap justify-end gap-3 text-sm font-semibold text-brand-700">
              <button type="button" className="hover:underline" onClick={() => setOpened(new Set())}>
                Collapse all
              </button>
              <button type="button" className="hover:underline" onClick={() => setOpened(new Set(sections.map((x) => x.category)))}>
                Expand all
              </button>
            </div>
          )}

          {/* Phones get one card per product; wider screens line the same cells up as columns. */}
          <div className="overflow-hidden rounded-xl border border-line">
            <div className="hidden grid-cols-[minmax(0,1fr)_11rem_9rem_10rem] gap-3 bg-surface px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
              <span>Product</span>
              <span>Bundles</span>
              <span>Loose</span>
              <span>In hand</span>
            </div>
            {sections.map((section) => {
              const open = Boolean(search.trim()) || isOpen(section.category);
              const done = section.items.filter((p) => totalOf(p, counts[p.id]) !== null).length;
              return (
              <section key={section.category} aria-label={section.category}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => {
                      const next = new Set(sections.map((x) => x.category).filter(isOpen));
                      if (open) next.delete(section.category);
                      else next.add(section.category);
                      setOpened(next);
                    }}
                    className="flex w-full items-center justify-between gap-2 border-t border-brand-800 bg-brand-700 px-3 py-2 text-left text-sm font-semibold text-white hover:bg-brand-800"
                  >
                    <span className="flex items-center gap-2">
                      <ChevronDown aria-hidden className={`h-4 w-4 transition ${open ? "" : "-rotate-90"}`} />
                      {section.category}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${done === section.items.length ? "bg-white text-brand-800" : "bg-white/15"}`}>
                      {done}/{section.items.length} counted
                    </span>
                  </button>
                </h3>
                {open && (
                <ul className="divide-y divide-line bg-white">
                  {section.items.map((product) => {
                    const count = counts[product.id];
                    const total = totalOf(product, count);
                    return (
                      <li key={product.id} className="grid grid-cols-2 items-center gap-x-3 gap-y-2 px-3 py-3 md:grid-cols-[minmax(0,1fr)_11rem_9rem_10rem]">
                        <span className="col-span-2 font-medium text-ink md:col-span-1">{product.name}</span>
                        {product.bundle_unit ? (
                          <label className="flex items-center gap-2">
                            <input
                              aria-label={`Bundles of ${product.name}`}
                              className={`${inputClass} w-20`}
                              inputMode="numeric"
                              value={count?.bundles ?? ""}
                              onChange={(event) => setCount(product.id, { bundles: event.target.value })}
                            />
                            <span className="text-xs leading-tight text-muted">
                              {product.bundle_unit}
                              <span className="block whitespace-nowrap">= {product.bundle_qty} {product.base_unit}</span>
                            </span>
                          </label>
                        ) : (
                          <span className="text-xs text-muted">No bundle size</span>
                        )}
                        <label className="flex items-center gap-2">
                          <input
                            aria-label={`Loose ${product.base_unit} of ${product.name}`}
                            className={`${inputClass} w-20`}
                            inputMode="numeric"
                            value={count?.loose ?? ""}
                            onChange={(event) => setCount(product.id, { loose: event.target.value })}
                            onBlur={() => rollUp(product)}
                          />
                          <span className="text-xs text-muted">{product.base_unit}</span>
                        </label>
                        <span className="col-span-2 text-sm md:col-span-1">
                          <span className="mr-1 text-xs text-muted md:hidden">In hand:</span>
                          {total === null ? (
                            <span className="text-muted">Not counted</span>
                          ) : Number.isSafeInteger(total) ? (
                            <span className="font-semibold text-ink">{formatQty(total, product, product.base_unit)}</span>
                          ) : (
                            <span className="text-red-700">Whole numbers only</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                )}
              </section>
              );
            })}
            {visibleProducts.length === 0 && <p className="px-3 py-5 text-center text-muted">No products match this search.</p>}
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
              <ChangeRows
                lines={reviewLines.map((line) => ({ ...line, key: line.product_id }))}
                products={byId}
              />
              <button type="button" className={primaryButton} disabled={busy} onClick={() => void saveStocktake()}>
                {busy ? "Saving…" : "Confirm and save stocktake"}
              </button>
            </div>
          )}
        </section>
      )}

      <StocktakeHistory
        history={history}
        selected={selected}
        onOpen={(id) => void showDetails(id)}
        onClose={() => setSelected(null)}
        onRefresh={() => void load()}
      >
        {selected && (
          <ChangeRows
            lines={selected.lines.map((line) => ({ ...line, key: line.id }))}
            products={byId}
          />
        )}
      </StocktakeHistory>
    </div>
  );
}
