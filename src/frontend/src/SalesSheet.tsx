import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, FileUp, Plus } from "lucide-react";
import { api } from "./api";
import { stocktakeStartsExpanded } from "./Stocktake";
import type { Lot, Sale, StocktakeProduct } from "./types";
import { ErrorNote, SuccessNote, inputClass, primaryButton, secondaryButton } from "./ui";

/** One row of the sheet: what was sold of a product, and the lot (by id) it came from. "" = earliest expiry. */
type Entry = { bundles: string; loose: string; lot: string };
const EMPTY: Entry = { bundles: "", loose: "", lot: "" };

const isWhole = (text: string) => /^\d+$/.test(text.trim());
const blank = (text: string) => text.trim() === "";

/** Base units sold: null when nothing was typed, NaN when it is not whole numbers. */
function totalOf(product: StocktakeProduct, entry: Entry): number | null {
  if (blank(entry.bundles) && blank(entry.loose)) return null;
  if (![entry.bundles, entry.loose].filter((t) => !blank(t)).every(isWhole)) return NaN;
  return (blank(entry.bundles) ? 0 : Number(entry.bundles) * (product.bundle_qty ?? 0)) + (blank(entry.loose) ? 0 : Number(entry.loose));
}

function split(total: number, product: StocktakeProduct): Pick<Entry, "bundles" | "loose"> {
  if (!product.bundle_qty) return { bundles: "", loose: String(total) };
  return { bundles: String(Math.floor(total / product.bundle_qty)), loose: String(total % product.bundle_qty) };
}

/** Sales typed in like a stock count, or loaded from the sales sheet, each line from a labelled lot if named. */
export default function SalesSheet({
  storageId,
  saleDate,
  onSaved,
}: {
  storageId: number | null;
  saleDate: string;
  onSaved: (sale: Sale) => void;
}) {
  const [products, setProducts] = useState<StocktakeProduct[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [entries, setEntries] = useState<Record<number, Entry[]>>({});
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<Set<string> | null>(null);
  const [startExpanded] = useState(stocktakeStartsExpanded);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (storageId === null) return;
    setEntries({});
    setSource("");
    Promise.all([api.stocktakeProducts(storageId), api.lots()])
      .then(([p, l]) => {
        setProducts(p);
        setLots(l.filter((lot) => lot.storage_id === storageId && lot.left > 0));
      })
      .catch((e: Error) => setError(e.message));
  }, [storageId]);

  const lotsOf = useMemo(() => {
    const out = new Map<number, Lot[]>();
    for (const lot of lots) out.set(lot.product_id, [...(out.get(lot.product_id) ?? []), lot]);
    return out;
  }, [lots]);

  const sections = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const out: { category: string; items: StocktakeProduct[] }[] = [];
    for (const p of products) {
      if (query && !`${p.name} ${p.category}`.toLocaleLowerCase().includes(query)) continue;
      if (out[out.length - 1]?.category !== p.category) out.push({ category: p.category, items: [] });
      out[out.length - 1].items.push(p);
    }
    return out;
  }, [products, search]);
  const isOpen = (category: string) => Boolean(search.trim()) || (opened ? opened.has(category) : startExpanded);

  const rowsOf = (id: number) => entries[id] ?? [EMPTY];
  function setEntry(id: number, index: number, patch: Partial<Entry>) {
    setNotice("");
    setEntries((current) => {
      const rows = [...(current[id] ?? [EMPTY])];
      rows[index] = { ...rows[index], ...patch };
      return { ...current, [id]: rows };
    });
  }

  // Each typed row as a sale line; rows of the same product and lot are added up.
  const typed = products.flatMap((p) => rowsOf(p.id).map((entry) => ({ product: p, entry, total: totalOf(p, entry) })));
  const invalid = typed.find((t) => t.total !== null && !Number.isSafeInteger(t.total));
  const merged = new Map<string, { product_id: number; quantity: number; lot_id: number | null }>();
  for (const { product, entry, total } of typed) {
    if (!total || !Number.isSafeInteger(total)) continue;
    const key = `${product.id}:${entry.lot}`;
    const line = merged.get(key) ?? { product_id: product.id, quantity: 0, lot_id: entry.lot ? Number(entry.lot) : null };
    line.quantity += total;
    merged.set(key, line);
  }
  const lines = [...merged.values()];

  async function download() {
    if (storageId === null) return;
    try {
      const url = URL.createObjectURL(await api.salesTemplate(storageId));
      const link = document.createElement("a");
      link.href = url;
      link.download = "sales-sheet.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function upload(file: File) {
    if (storageId === null) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const preview = await api.previewSales(file, storageId);
      const byId = new Map(products.map((p) => [p.id, p]));
      const next: Record<number, Entry[]> = {};
      for (const line of preview.lines) {
        const product = byId.get(line.product_id);
        const amount = product ? split(line.quantity, product) : { bundles: "", loose: String(line.quantity) };
        next[line.product_id] = [...(next[line.product_id] ?? []), { ...amount, lot: line.lot_id ? String(line.lot_id) : "" }];
      }
      setEntries(next);
      setSource(file.name);
      setNotice(
        `${preview.lines.length} lines loaded. Check them, then take them off stock.` +
          (preview.unknown_codes.length ? ` No product has these codes, so they are left out: ${preview.unknown_codes.join(", ")}` : ""),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (storageId === null || invalid || lines.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.createSale({ storage_id: storageId, sale_date: saleDate, source: source || "Sales sheet", lines });
      const short = saved.lines.filter((l) => l.deducted < l.quantity).length;
      setNotice(
        `${saved.reference} saved: ${saved.lines.length} lines taken off ${saved.storage}.` +
          (short ? ` ${short} sold more than was in stock; count those soon.` : ""),
      );
      setEntries({});
      setSource("");
      onSaved(saved);
      const fresh = await api.lots();
      setLots(fresh.filter((lot) => lot.storage_id === storageId && lot.left > 0));
      setProducts(await api.stocktakeProducts(storageId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label className="sr-only" htmlFor="sales-search">Find a product</label>
          <input
            id="sales-search"
            className={inputClass}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product or category"
          />
        </div>
        <button type="button" className={secondaryButton} onClick={() => void download()}>
          <Download aria-hidden className="h-4 w-4" />
          Sales sheet
        </button>
        <label className={`${secondaryButton} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
          <FileUp aria-hidden className="h-4 w-4" />
          Upload sales sheet
          <input
            className="sr-only"
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              e.target.value = "";
              if (chosen) void upload(chosen);
            }}
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        {sections.map((section) => {
          const open = isOpen(section.category);
          const done = section.items.filter((p) => rowsOf(p.id).some((e) => totalOf(p, e) !== null)).length;
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
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs tabular-nums">{done} sold</span>
                </button>
              </h3>
              {open && (
                <ul className="divide-y divide-line bg-white">
                  {section.items.map((product) => {
                    const choices = lotsOf.get(product.id) ?? [];
                    const rows = rowsOf(product.id);
                    return (
                      <li key={product.id} className="space-y-2 px-3 py-3">
                        <p className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-medium text-ink">{product.name}</span>
                          <span className="text-xs text-muted">in stock {product.stock} {product.base_unit}</span>
                        </p>
                        {rows.map((entry, index) => {
                          const total = totalOf(product, entry);
                          const lot = choices.find((l) => String(l.id) === entry.lot);
                          const over = lot && total !== null && total > lot.left;
                          return (
                            <div key={index} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                              {product.bundle_unit && (
                                <label className="flex items-center gap-2">
                                  <input
                                    aria-label={`Bundles of ${product.name} sold`}
                                    className={`${inputClass} w-20`}
                                    inputMode="numeric"
                                    value={entry.bundles}
                                    onChange={(e) => setEntry(product.id, index, { bundles: e.target.value })}
                                  />
                                  <span className="text-xs leading-tight text-muted">
                                    {product.bundle_unit}
                                    <span className="block whitespace-nowrap">= {product.bundle_qty} {product.base_unit}</span>
                                  </span>
                                </label>
                              )}
                              <label className="flex items-center gap-2">
                                <input
                                  aria-label={`Loose ${product.base_unit} of ${product.name} sold`}
                                  className={`${inputClass} w-20`}
                                  inputMode="numeric"
                                  value={entry.loose}
                                  onChange={(e) => setEntry(product.id, index, { loose: e.target.value })}
                                />
                                <span className="text-xs text-muted">{product.base_unit}</span>
                              </label>
                              {choices.length > 0 && (
                                <select
                                  aria-label={`Lot of ${product.name} used`}
                                  className={`${inputClass} w-full sm:w-auto`}
                                  value={entry.lot}
                                  onChange={(e) => setEntry(product.id, index, { lot: e.target.value })}
                                >
                                  <option value="">Lot: earliest expiry</option>
                                  {choices.map((l) => (
                                    <option key={l.id} value={l.id}>
                                      {l.code} · {l.expiry_on ?? "no date"} · {l.left} left
                                    </option>
                                  ))}
                                </select>
                              )}
                              {total !== null && !Number.isSafeInteger(total) && <span className="text-sm text-red-700">Whole numbers only</span>}
                              {over && <span className="text-sm text-red-700">Lot has only {lot.left} left</span>}
                            </div>
                          );
                        })}
                        {choices.length > 1 && rows.length < choices.length && (
                          <button
                            type="button"
                            className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
                            onClick={() => setEntries((current) => ({ ...current, [product.id]: [...rows, EMPTY] }))}
                          >
                            <Plus aria-hidden className="h-4 w-4" />
                            Another lot
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
        {sections.length === 0 && <p className="px-3 py-5 text-center text-muted">No products match this search.</p>}
      </div>

      {error && <ErrorNote message={error} />}
      {notice && <SuccessNote>{notice}</SuccessNote>}
      <button type="button" className={primaryButton} disabled={busy || Boolean(invalid) || lines.length === 0} onClick={() => void save()}>
        {busy ? "Saving…" : `Take ${lines.length} ${lines.length === 1 ? "line" : "lines"} off stock`}
      </button>
    </div>
  );
}
