import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Download, FileUp, Plus, Trash2 } from "lucide-react";
import { api } from "./api";
import SearchSelect from "./SearchSelect";
import { StorageSelect, firstStorageId, useStorages } from "./StorageSelect";
import type { Sale, SalePreview, StockLevel, Transfer } from "./types";
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

type Tab = "levels" | "transfer" | "sales";

const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** Stock in each storage area, moving it between them, and taking uploaded sales off it. */
export default function StockMoves({ canEdit }: { canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>("levels");
  const storages = useStorages();
  const tabs: { id: Tab; label: string }[] = [
    { id: "levels", label: "Stock by storage" },
    { id: "transfer", label: "Transfers" },
    { id: "sales", label: "Sales" },
  ];
  return (
    <div className="space-y-6">
      <PageTitle
        title="Stock & sales"
        subtitle="See what each outlet and storage area holds, move stock between them, and upload sales so the next count shows only real losses."
      />
      <div role="tablist" aria-label="Stock & sales" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={tab === t.id ? primaryButton : secondaryButton}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "levels" && <Levels storages={storages} />}
      {tab === "transfer" && <Transfers storages={storages} canEdit={canEdit} />}
      {tab === "sales" && <Sales storages={storages} canEdit={canEdit} />}
    </div>
  );
}

type Storages = ReturnType<typeof useStorages>;

function useStock(storageId: number | null) {
  const [rows, setRows] = useState<StockLevel[]>([]);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    if (storageId === null) return;
    api
      .stockIn(storageId)
      .then((found) => {
        setRows(found);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, [storageId]);
  useEffect(reload, [reload]);
  return { rows, error, reload };
}

function Levels({ storages }: { storages: Storages }) {
  const [picked, setPicked] = useState<number | null>(null);
  const storageId = picked ?? firstStorageId(storages);
  const { rows, error } = useStock(storageId);
  const [search, setSearch] = useState("");
  const shown = rows.filter((r) => `${r.name} ${r.code ?? ""} ${r.category}`.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <section className={`${cardClass} space-y-4`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <StorageSelect id="levels-storage" label="Storage area" storages={storages} value={storageId} onChange={setPicked} />
        </div>
        <div className="min-w-56 flex-1">
          <label className={labelClass} htmlFor="levels-search">
            Find a product
          </label>
          <input id="levels-search" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, code or category" />
        </div>
      </div>
      {error && <ErrorNote message={error} />}
      {shown.length === 0 ? (
        <Empty>No products to show.</Empty>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          <li className="hidden grid-cols-[minmax(0,1.6fr)_1fr_1fr] gap-3 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted sm:grid">
            <span>Product</span>
            <span>Here</span>
            <span>All storage areas</span>
          </li>
          {shown.map((r) => (
            <li key={r.product_id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1.6fr)_1fr_1fr]">
              <span className="col-span-2 sm:col-span-1">
                <span className="font-medium text-ink">{r.name}</span>
                {r.code && <span className="ml-2 font-mono text-xs text-muted">{r.code}</span>}
                <span className="block text-xs text-muted">{r.category}</span>
              </span>
              <span className="font-semibold text-ink">
                <span className="text-xs font-normal text-muted sm:hidden">Here </span>
                {r.quantity} {r.base_unit}
              </span>
              <span className="text-slate-600">
                <span className="text-xs text-muted sm:hidden">All </span>
                {r.total} {r.base_unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Line = { key: number; productId: string; quantity: string };
let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, productId: "", quantity: "" });

function Transfers({ storages, canEdit }: { storages: Storages; canEdit: boolean }) {
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const source = from ?? firstStorageId(storages);
  const { rows, reload } = useStock(source);
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<Transfer[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadHistory = useCallback(() => {
    api.transfers().then(setHistory).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  const held = useMemo(() => new Map(rows.map((r) => [r.product_id, r])), [rows]);
  const options = rows
    .filter((r) => r.quantity > 0)
    .map((r) => ({ value: String(r.product_id), label: `${r.name} (${r.quantity} ${r.base_unit})`, group: r.category }));

  async function submit() {
    setError("");
    setNotice("");
    if (source === null || to === null) return setError("Choose where the stock comes from and where it goes.");
    if (source === to) return setError("Choose two different storage areas.");
    const filled = lines.filter((l) => l.productId || l.quantity.trim());
    if (filled.length === 0) return setError("Add at least one product to move.");
    if (filled.some((l) => !l.productId || !/^[1-9]\d*$/.test(l.quantity.trim())))
      return setError("Each line needs a product and a whole number above 0.");
    setBusy(true);
    try {
      const saved = await api.createTransfer({
        from_storage_id: source,
        to_storage_id: to,
        notes: notes.trim(),
        lines: filled.map((l) => ({ product_id: Number(l.productId), quantity: Number(l.quantity.trim()) })),
      });
      setNotice(`${saved.reference} saved: moved to ${saved.to_storage}.`);
      setLines([blankLine()]);
      setNotes("");
      reload();
      loadHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {canEdit && (
        <section className={`${cardClass} space-y-4`}>
          <div>
            <SectionTitle>Move stock</SectionTitle>
            <p className="mt-1 text-sm text-muted">Quantities are in each product's base unit. The move happens at once and is logged.</p>
          </div>
          {storages.length < 2 ? (
            <p className="text-sm text-slate-700">Add a second outlet or storage area in Settings to move stock between them.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
                <StorageSelect
                  id="transfer-from"
                  label="From"
                  storages={storages}
                  value={source}
                  onChange={(id) => {
                    setFrom(id);
                    setLines([blankLine()]);
                  }}
                />
                <ArrowRight aria-hidden className="mx-auto mb-3 hidden h-5 w-5 text-muted sm:block" />
                <StorageSelect id="transfer-to" label="To" storages={storages.filter((s) => s.id !== source)} value={to === source ? null : to} onChange={setTo} />
              </div>
              <ul className="space-y-2">
                {lines.map((line, i) => {
                  const product = held.get(Number(line.productId));
                  return (
                    <li key={line.key} className="flex flex-wrap items-end gap-2">
                      <div className="min-w-56 flex-1">
                        <label className={labelClass} htmlFor={`transfer-product-${line.key}`}>
                          Product {i + 1}
                        </label>
                        <SearchSelect
                          id={`transfer-product-${line.key}`}
                          options={options}
                          value={line.productId}
                          noun="products"
                          onChange={(value) => setLines((all) => all.map((l) => (l.key === line.key ? { ...l, productId: value } : l)))}
                        />
                      </div>
                      <div className="w-36">
                        <label className={labelClass} htmlFor={`transfer-qty-${line.key}`}>
                          Quantity{product ? ` (${product.base_unit})` : ""}
                        </label>
                        <input
                          id={`transfer-qty-${line.key}`}
                          inputMode="numeric"
                          className={inputClass}
                          value={line.quantity}
                          onChange={(e) => setLines((all) => all.map((l) => (l.key === line.key ? { ...l, quantity: e.target.value } : l)))}
                        />
                      </div>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove product ${i + 1}`}
                          className={secondaryButton}
                          onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                        >
                          <Trash2 aria-hidden className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button type="button" className={secondaryButton} onClick={() => setLines((all) => [...all, blankLine()])}>
                <Plus aria-hidden className="h-4 w-4" />
                Add product
              </button>
              <div>
                <label className={labelClass} htmlFor="transfer-notes">
                  Notes (optional)
                </label>
                <input id="transfer-notes" maxLength={500} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              {error && <ErrorNote message={error} />}
              {notice && <SuccessNote>{notice}</SuccessNote>}
              <button type="button" className={primaryButton} disabled={busy} onClick={() => void submit()}>
                {busy ? "Moving…" : "Move stock"}
              </button>
            </>
          )}
        </section>
      )}
      <section className="space-y-3">
        <SectionTitle>Recent transfers</SectionTitle>
        {!canEdit && error && <ErrorNote message={error} />}
        {history.length === 0 ? (
          <Empty>No transfers yet.</Empty>
        ) : (
          history.map((t) => (
            <article key={t.id} className={`${cardClass} space-y-1 text-sm`}>
              <p className="font-semibold text-ink">
                {t.reference}: {t.from_storage} → {t.to_storage}
              </p>
              <p className="text-muted">
                {when(t.created_at)} by {t.moved_by}
                {t.notes && ` · ${t.notes}`}
              </p>
              <p className="text-slate-700">{t.lines.map((l) => `${l.product_name} ${l.quantity} ${l.base_unit}`).join(", ")}</p>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function Sales({ storages, canEdit }: { storages: Storages; canEdit: boolean }) {
  const [picked, setPicked] = useState<number | null>(null);
  const storageId = picked ?? firstStorageId(storages);
  const [saleDate, setSaleDate] = useState(localDate());
  const [file, setFile] = useState("");
  const [preview, setPreview] = useState<SalePreview | null>(null);
  const [history, setHistory] = useState<Sale[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadHistory = useCallback(() => {
    api.sales().then(setHistory).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  async function read(chosen: File) {
    if (storageId === null) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setPreview(await api.previewSales(chosen, storageId));
      setFile(chosen.name);
    } catch (e) {
      setPreview(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview || storageId === null) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.createSale({
        storage_id: storageId,
        sale_date: saleDate,
        source: file,
        lines: preview.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
      });
      const short = saved.lines.filter((l) => l.deducted < l.quantity).length;
      setNotice(
        `${saved.reference} saved: ${saved.lines.length} products taken off ${saved.storage}.` +
          (short ? ` ${short} sold more than was in stock; count those soon.` : ""),
      );
      setPreview(null);
      setFile("");
      loadHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function template() {
    try {
      const url = URL.createObjectURL(await api.salesTemplate());
      const link = document.createElement("a");
      link.href = url;
      link.download = "sales-template.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      {canEdit && (
        <section className={`${cardClass} space-y-4`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SectionTitle>Upload sales</SectionTitle>
              <p className="mt-1 max-w-xl text-sm text-muted">
                An .xlsx or .csv with a Product code column and a Quantity column, e.g. your POS export. Codes are set on each
                product in Products &amp; SOP; quantities are in the product's base unit.
              </p>
            </div>
            <button type="button" className={secondaryButton} onClick={() => void template()}>
              <Download aria-hidden className="h-4 w-4" />
              Sales template
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56">
              <StorageSelect
                id="sales-storage"
                label="Sold from"
                storages={storages}
                value={storageId}
                onChange={(id) => {
                  setPicked(id);
                  setPreview(null);
                }}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="sales-date">
                Sale date
              </label>
              <input id="sales-date" type="date" className={inputClass} value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
            </div>
            <label className={`${secondaryButton} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
              <FileUp aria-hidden className="h-4 w-4" />
              Choose sales sheet
              <input
                className="sr-only"
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  e.target.value = "";
                  if (chosen) void read(chosen);
                }}
              />
            </label>
          </div>
          {preview && (
            <div className="space-y-3">
              {preview.unknown_codes.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  No product has {preview.unknown_codes.length === 1 ? "this code" : "these codes"}, so{" "}
                  {preview.unknown_codes.length === 1 ? "it is" : "they are"} left out: {preview.unknown_codes.join(", ")}
                </p>
              )}
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {preview.lines.map((l) => (
                  <li key={l.product_id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                    <span>
                      <span className="font-medium text-ink">{l.product_name}</span>
                      <span className="ml-2 font-mono text-xs text-muted">{l.code}</span>
                    </span>
                    <span className={l.quantity > l.in_stock ? "font-semibold text-red-700" : "text-slate-700"}>
                      sold {l.quantity} {l.base_unit} · in stock {l.in_stock}
                      {l.quantity > l.in_stock && ` (${l.quantity - l.in_stock} short)`}
                    </span>
                  </li>
                ))}
              </ul>
              {preview.lines.length > 0 && (
                <button type="button" className={primaryButton} disabled={busy} onClick={() => void save()}>
                  {busy ? "Saving…" : `Take ${preview.lines.length} products off stock`}
                </button>
              )}
            </div>
          )}
          {error && <ErrorNote message={error} />}
          {notice && <SuccessNote>{notice}</SuccessNote>}
        </section>
      )}
      <section className="space-y-3">
        <SectionTitle>Recent sales</SectionTitle>
        {history.length === 0 ? (
          <Empty>No sales uploaded yet.</Empty>
        ) : (
          history.map((s) => (
            <article key={s.id} className={`${cardClass} space-y-1 text-sm`}>
              <p className="font-semibold text-ink">
                {s.reference}: {s.storage}, {s.sale_date}
              </p>
              <p className="text-muted">
                {when(s.created_at)} by {s.recorded_by}
                {s.source && ` · ${s.source}`}
              </p>
              <p className="text-slate-700">
                {s.lines
                  .map((l) => `${l.product_name} ${l.quantity} ${l.base_unit}${l.deducted < l.quantity ? ` (${l.quantity - l.deducted} short)` : ""}`)
                  .join(", ")}
              </p>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
