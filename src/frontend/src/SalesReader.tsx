import { useCallback, useEffect, useMemo, useState } from "react";
import { FileUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { api } from "./api";
import { imageToJpegBase64 } from "./image";
import SearchSelect from "./SearchSelect";
import type { Product, SaleDraftKept, SalesDraft, SalesDraftLine, SoldItem } from "./types";
import { ErrorNote, SectionTitle, SuccessNote, inputClass, labelClass, primaryButton, secondaryButton, when } from "./ui";

type Part = { productId: string; per: string };
type Edit = { notStock: boolean; parts: Part[]; answer: string; remember: boolean };

const CHIP: Record<SalesDraftLine["status"], [string, string]> = {
  matched: ["Matched", "bg-emerald-50 text-emerald-800"],
  suggested: ["AI suggests: check", "bg-sky-50 text-sky-800"],
  question: ["Needs you", "bg-amber-50 text-amber-900"],
  not_stock: ["Not stock", "bg-slate-100 text-slate-700"],
};

const editOf = (l: SalesDraftLine): Edit => ({
  notStock: l.status === "not_stock",
  parts: l.components.map((c) => ({ productId: String(c.product_id), per: String(c.per_sold) })),
  answer: "",
  remember: true,
});

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
    reader.onerror = () => reject(new Error("Could not open that file"));
    reader.readAsDataURL(file);
  });

/** Any sales report (photo, PDF, sheet or pasted text) read with AI, checked by a person, then taken off stock. */
export default function SalesReader({
  storageId,
  saleDate,
  onDate,
  onSaved,
}: {
  storageId: number | null;
  saleDate: string;
  onDate: (date: string) => void;
  onSaved: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [kept, setKept] = useState<SaleDraftKept[]>([]);
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [draft, setDraft] = useState<SalesDraft | null>(null);
  const [items, setItems] = useState<SoldItem[]>([]);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [from, setFrom] = useState<{ storageId: number; draftId: number } | null>(null); // finishing a till's sale
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadKept = useCallback(() => {
    api.saleDrafts().then(setKept).catch(() => setKept([]));
  }, []);
  useEffect(() => {
    api.products().then((all) => setProducts(all.filter((p) => !p.archived))).catch(() => setProducts([]));
    loadKept();
  }, [loadKept]);

  const options = useMemo(
    () => products.map((p) => ({ value: String(p.id), label: `${p.name} (${p.base_unit})`, codes: p.code ? [p.code] : [] })),
    [products],
  );
  const byId = useMemo(() => new Map(products.map((p) => [String(p.id), p])), [products]);

  async function run(body: Parameters<typeof api.readSales>[0], keep?: Edit[]) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const read = await api.readSales(body);
      setDraft(read);
      setItems(read.lines.map((l) => ({ name: l.name, code: l.code, quantity: l.quantity, unit: l.unit })));
      // Asking again: keep what a person already set on lines that did not need them.
      setEdits(read.lines.map((l, i) => (keep && keep[i] && draft?.lines[i]?.status !== "question" ? keep[i] : editOf(l))));
      if (read.sale_date) onDate(read.sale_date);
      if (read.lines.length === 0) setError("No sold items were found.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file: File) {
    if (storageId === null) return;
    setFrom(null);
    setSource(file.name);
    try {
      const photo = file.type.startsWith("image/");
      const data = photo ? await imageToJpegBase64(file) : await fileToBase64(file);
      await run({ storage_id: storageId, filename: photo ? "photo.jpg" : file.name, data });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const update = (i: number, change: Partial<Edit>) => setEdits((all) => all.map((e, n) => (n === i ? { ...e, ...change } : e)));
  const setPart = (i: number, j: number, change: Partial<Part>) =>
    update(i, { parts: edits[i].parts.map((p, n) => (n === j ? { ...p, ...change } : p)) });

  // What will come off stock, worked out from the lines as they now stand.
  const totals = useMemo(() => {
    const sum = new Map<string, number>();
    items.forEach((item, i) => {
      const e = edits[i];
      if (!e || e.notStock) return;
      for (const p of e.parts) {
        const per = Number(p.per);
        if (p.productId && per > 0) sum.set(p.productId, (sum.get(p.productId) ?? 0) + Math.round(item.quantity * per));
      }
    });
    return [...sum.entries()].filter(([, q]) => q > 0);
  }, [items, edits]);

  const open = edits.filter((e) => !e.notStock && !e.parts.some((p) => p.productId && Number(p.per) > 0)).length;
  const answers = Object.fromEntries(items.map((item, i) => [item.name, edits[i]?.answer ?? ""]).filter(([, a]) => a.trim()));

  async function confirm() {
    const at = from?.storageId ?? storageId;
    if (!draft || at === null) return;
    if (open) {
      setError(`${open} line${open === 1 ? "" : "s"} still need${open === 1 ? "s" : ""} a product, or "Not stock".`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const sale = await api.confirmSales({
        storage_id: at,
        sale_date: saleDate,
        source: source || "Sales read with AI",
        draft_id: from?.draftId ?? null,
        lines: items.map((item, i) => ({
          name: item.name,
          code: item.code ?? null,
          quantity: item.quantity,
          not_stock: edits[i].notStock,
          components: edits[i].notStock
            ? []
            : edits[i].parts.filter((p) => p.productId && Number(p.per) > 0).map((p) => ({ product_id: Number(p.productId), per_sold: Number(p.per) })),
          remember: edits[i].remember,
        })),
      });
      const short = sale.lines.filter((l) => l.deducted < l.quantity).length;
      setNotice(
        `${sale.reference} saved: ${sale.lines.length} products taken off ${sale.storage}. Matches are remembered for next time.` +
          (short ? ` ${short} sold more than was in stock; count those soon.` : ""),
      );
      setDraft(null);
      setItems([]);
      setEdits([]);
      setText("");
      setFrom(null);
      loadKept();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 border-t border-line pt-4">
      <div>
        <SectionTitle>Read any sales report</SectionTitle>
        <p className="mt-1 max-w-xl text-sm text-muted">
          A photo, PDF or sheet from any till, or paste the text. Menu items are matched to products; you check, then it comes off stock.
        </p>
      </div>
      {kept.length > 0 && (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Till sales waiting for you</p>
          {kept.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {k.storage}, {k.sale_date}: {k.items.length} items · {when(k.created_at)}
              </span>
              <button
                type="button"
                className={secondaryButton}
                disabled={busy}
                onClick={() => {
                  setFrom({ storageId: k.storage_id, draftId: k.id });
                  setSource(k.source);
                  onDate(k.sale_date);
                  void run({ storage_id: k.storage_id, draft_id: k.id });
                }}
              >
                Finish
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label className={`${primaryButton} cursor-pointer ${busy || storageId === null ? "pointer-events-none opacity-60" : ""}`}>
          <FileUp aria-hidden className="h-4 w-4" />
          {busy ? "Reading…" : "Read a report"}
          <input
            className="sr-only"
            type="file"
            accept="image/*,.pdf,.xlsx,.csv"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              e.target.value = "";
              if (chosen) void readFile(chosen);
            }}
          />
        </label>
      </div>
      <div>
        <label className={labelClass} htmlFor="sales-paste">
          Or paste the sales
        </label>
        <textarea
          id="sales-paste"
          rows={3}
          maxLength={60000}
          className={inputClass}
          placeholder="Hot Dog Set 12&#10;Iced Lemon Tea 30"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className={`${secondaryButton} mt-2`}
          disabled={busy || !text.trim() || storageId === null}
          onClick={() => {
            setFrom(null);
            setSource("Pasted sales");
            void run({ storage_id: storageId!, text });
          }}
        >
          Read pasted sales
        </button>
      </div>

      {draft && (
        <div className="space-y-3">
          {!draft.ai_available && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">AI is off: match the lines by hand.</p>
          )}
          <ul className="space-y-3">
            {items.map((item, i) => {
              const line = draft.lines[i];
              const e = edits[i];
              const [chip, tone] = CHIP[line.status];
              return (
                <li key={i} data-testid="sold-line" className="space-y-2 rounded-lg border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words font-medium text-ink">
                      {item.quantity} × {item.name}
                      {item.code && <span className="ml-2 font-mono text-xs text-muted">{item.code}</span>}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{chip}</span>
                  </div>
                  {line.question && !e.notStock && (
                    <div>
                      <label className={labelClass} htmlFor={`sold-answer-${i}`}>
                        {line.question}
                      </label>
                      <input
                        id={`sold-answer-${i}`}
                        maxLength={500}
                        className={inputClass}
                        value={e.answer}
                        onChange={(ev) => update(i, { answer: ev.target.value })}
                      />
                    </div>
                  )}
                  {!e.notStock &&
                    e.parts.map((p, j) => (
                      <div key={j} className="flex flex-wrap items-end gap-2">
                        <div className="min-w-0 flex-1 basis-48">
                          <SearchSelect
                            id={`sold-${i}-product-${j}`}
                            options={options}
                            value={p.productId}
                            noun="products"
                            onChange={(v) => setPart(i, j, { productId: v })}
                          />
                        </div>
                        <div className="w-28">
                          <label className={labelClass} htmlFor={`sold-${i}-per-${j}`}>
                            Each uses {byId.get(p.productId)?.base_unit ?? ""}
                          </label>
                          <input
                            id={`sold-${i}-per-${j}`}
                            inputMode="decimal"
                            className={inputClass}
                            value={p.per}
                            onChange={(ev) => setPart(i, j, { per: ev.target.value })}
                          />
                        </div>
                        <button
                          type="button"
                          aria-label="Remove product"
                          className={secondaryButton}
                          onClick={() => update(i, { parts: e.parts.filter((_, n) => n !== j) })}
                        >
                          <Trash2 aria-hidden className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  <div className="flex flex-wrap items-center gap-3">
                    {!e.notStock && (
                      <button type="button" className={secondaryButton} onClick={() => update(i, { parts: [...e.parts, { productId: "", per: "1" }] })}>
                        <Plus aria-hidden className="h-4 w-4" />
                        Add product
                      </button>
                    )}
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={e.notStock} onChange={(ev) => update(i, { notStock: ev.target.checked })} />
                      Not stock
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={e.remember} onChange={(ev) => update(i, { remember: ev.target.checked })} />
                      Remember
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
          {Object.keys(answers).length > 0 && draft.ai_available && (
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={() => void run({ storage_id: from?.storageId ?? storageId!, items, answers }, edits)}
            >
              <Sparkles aria-hidden className="h-4 w-4" />
              Ask AI again with my answers
            </button>
          )}
          {totals.length > 0 && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-ink">Comes off stock</p>
              <ul className="mt-1 space-y-0.5 text-slate-700">
                {totals.map(([id, q]) => (
                  <li key={id}>
                    {byId.get(id)?.name ?? "Product"}: {q} {byId.get(id)?.base_unit}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" className={primaryButton} disabled={busy} onClick={() => void confirm()}>
            {busy ? "Saving…" : open ? `${open} line${open === 1 ? "" : "s"} to check` : "Take off stock"}
          </button>
        </div>
      )}
      {error && <ErrorNote message={error} />}
      {notice && <SuccessNote>{notice}</SuccessNote>}
    </div>
  );
}
