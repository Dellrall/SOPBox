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

export default function Stocktake({ canEdit }: { canEdit: boolean }) {
  const [products, setProducts] = useState<StocktakeProduct[]>([]);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.stocktakes>>>([]);
  const [counts, setCounts] = useState<Record<number, string>>({});
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

  const counted = products.filter((product) => (counts[product.id] ?? "").trim() !== "");
  const invalidProduct = counted.find((product) => {
    const number = Number(counts[product.id]);
    return !Number.isSafeInteger(number) || number < 0;
  });

  function setCount(productId: number, value: string) {
    setReviewing(false);
    setNotice("");
    setCounts((current) => ({ ...current, [productId]: value }));
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
      const next: Record<number, string> = {};
      for (const line of preview.lines) next[line.product_id] = String(line.counted_stock);
      setCounts(next);
      setNotice(`${preview.lines.length} counted products loaded. Review the quantities before saving.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const reviewLines: StocktakePreviewLine[] = counted.flatMap((product) => {
    const quantity = Number(counts[product.id]);
    if (!Number.isSafeInteger(quantity) || quantity < 0) return [];
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
        subtitle="Count the total quantity for each product in its base unit. Blank counts stay unchanged; enter 0 only when you counted zero."
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
            <p className="mt-1 text-sm text-muted">Enter the physical total. The system quantity is shown in the review step.</p>
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
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Physical count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {visibleProducts.map((product) => (
                  <tr key={product.id}>
                    <td className="px-3 py-2.5 font-medium text-ink">{product.name}</td>
                    <td className="px-3 py-2.5 text-muted">{product.category}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          aria-label={`Physical count for ${product.name}`}
                          className={`${inputClass} max-w-40`}
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={counts[product.id] ?? ""}
                          onChange={(event) => setCount(product.id, event.target.value)}
                        />
                        <span className="text-xs text-muted">{product.base_unit}</span>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleProducts.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-5 text-center text-muted">No products match this search.</td>
                  </tr>
                )}
              </tbody>
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
            <ErrorNote message={`${invalidProduct.name}: enter a whole number of 0 or more.`} />
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
                        <td className="px-3 py-2">{line.expected_stock} {line.base_unit}</td>
                        <td className="px-3 py-2">{line.counted_stock} {line.base_unit}</td>
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
                    <td className="py-2 pr-3">{line.expected_stock} {line.base_unit}</td>
                    <td className="py-2 pr-3">{line.counted_stock} {line.base_unit}</td>
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
