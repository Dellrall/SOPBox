import { useState } from "react";
import { Loader2 } from "lucide-react";
import { PhotoPicker } from "./PhotoPicker";
import { api } from "./api";
import { imageToJpegBase64 } from "./image";
import type { Category, ProductIn } from "./types";
import { ErrorNote, SectionTitle, TempInput, cardClass, inputClass, primaryButton, secondaryButton } from "./ui";

/** One suggestion as the manager is editing it. Strings, so half-typed numbers are allowed. */
type Row = {
  key: number;
  include: boolean;
  name: string;
  categoryId: string;
  newCategory: string; // the category name the model read, when no existing one matches
  baseUnit: string;
  packUnit: string;
  perPack: string;
  min: string;
  max: string;
  note: string;
};

let nextKey = 1;
const cell = `${inputClass} px-2.5 py-2 text-sm`;

/**
 * Photograph a supplier's product list or SOP sheet; the model suggests products; the manager
 * corrects and ticks them; the ticked ones are added together. Nothing is saved before that.
 */
export default function ImportSheet({
  categories,
  onCategoryAdded,
  onDone,
  onClose,
}: {
  categories: Category[];
  onCategoryAdded: () => Promise<Category[]>;
  onDone: (count: number) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<"" | "reading" | "saving">("");
  const [error, setError] = useState("");

  const set = (key: number, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function read(file: File) {
    setBusy("reading");
    setError("");
    try {
      const found = await api.readProductSheet(await imageToJpegBase64(file));
      if (found.length === 0) setError("No products were found on the photo.");
      setRows(
        found.map((s) => ({
          key: nextKey++,
          include: !s.exists,
          name: s.name,
          categoryId: s.category_id ? String(s.category_id) : "",
          newCategory: s.category_id ? "" : (s.category ?? ""),
          baseUnit: s.base_unit ?? "",
          packUnit: s.pack_unit ?? "",
          perPack: s.units_per_pack ? String(s.units_per_pack) : "",
          min: s.temp_min_c === null ? "" : String(s.temp_min_c),
          max: s.temp_max_c === null ? "" : String(s.temp_max_c),
          note: [s.exists ? "already in your catalogue" : null, s.warning].filter(Boolean).join("; "),
        })),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function addCategory(row: Row) {
    setError("");
    try {
      const made = await api.createCategory({ name: row.newCategory.trim(), temp_min_c: null, temp_max_c: null });
      await onCategoryAdded();
      // Every row waiting for that category name gets it.
      setRows((all) =>
        all.map((r) => (r.newCategory.trim().toLowerCase() === made.name.toLowerCase() ? { ...r, categoryId: String(made.id), newCategory: "" } : r)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save() {
    setError("");
    const chosen = rows.filter((r) => r.include);
    if (chosen.length === 0) return setError("Tick at least one product to add.");
    const body: ProductIn[] = [];
    for (const r of chosen) {
      const label = r.name.trim() || "A product";
      if (!r.name.trim()) return setError("Every ticked product needs a name.");
      if (!r.categoryId) return setError(`${label}: choose a category.`);
      if (!r.baseUnit.trim()) return setError(`${label}: enter the unit it is counted in (for example pcs).`);
      const perPack = Number(r.perPack);
      if (r.packUnit.trim() && (!Number.isInteger(perPack) || perPack <= 0))
        return setError(`${label}: enter how many ${r.baseUnit || "base units"} are in one ${r.packUnit}.`);
      const min = r.min.trim() === "" ? null : Number(r.min);
      const max = r.max.trim() === "" ? null : Number(r.max);
      if ((min === null) !== (max === null)) return setError(`${label}: fill in both temperatures, or neither.`);
      if ((min !== null && Number.isNaN(min)) || (max !== null && Number.isNaN(max))) return setError(`${label}: temperatures must be numbers.`);
      body.push({
        name: r.name.trim(),
        category_id: Number(r.categoryId),
        base_unit: r.baseUnit.trim(),
        temp_min_c: min,
        temp_max_c: max,
        min_stock: 0,
        sop: "",
        pack_units: r.packUnit.trim() ? [{ unit: r.packUnit.trim(), base_qty: perPack }] : [],
      });
    }
    setBusy("saving");
    try {
      const made = await api.createProducts(body);
      onDone(made.length);
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  }

  return (
    <section className={`${cardClass} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <SectionTitle>Import products from a supplier sheet</SectionTitle>
          <p className="mt-1 text-sm text-muted">
            Photograph a product list, price list or SOP sheet. The AI suggests products; you check and correct them before
            anything is added.
          </p>
        </div>
        <button className={secondaryButton} onClick={onClose}>
          Close
        </button>
      </div>

      <div>
        <PhotoPicker
          id="sheet-photo"
          takeClass={primaryButton}
          takeLabel={rows.length ? "Take another photo" : "Take photo"}
          chooseLabel={rows.length ? "Choose another photo" : "Choose photo"}
          disabled={busy !== ""}
          onFiles={(files) => void read(files[0])}
          busy={
            busy === "reading" && (
              <>
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Reading the sheet… (up to 3 min if the reader was asleep)
              </>
            )
          }
        />
      </div>

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="pb-2 pr-2 font-semibold">Add</th>
                  <th className="pb-2 pr-2 font-semibold">Name</th>
                  <th className="pb-2 pr-2 font-semibold">Category</th>
                  <th className="pb-2 pr-2 font-semibold">Counted in</th>
                  <th className="pb-2 pr-2 font-semibold">Pack</th>
                  <th className="pb-2 pr-2 font-semibold">Per pack</th>
                  <th className="pb-2 font-semibold">°C low / high</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {rows.map((r, i) => (
                  <tr key={r.key} className="border-t border-line">
                    <td className="py-2 pr-2">
                      <input type="checkbox" aria-label={`Add product ${i + 1}`} className="mt-3 h-4 w-4 accent-brand-600" checked={r.include} onChange={(e) => set(r.key, { include: e.target.checked })} />
                    </td>
                    <td className="py-2 pr-2">
                      <input aria-label={`Name, product ${i + 1}`} className={cell} value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} />
                      {r.note && <p className="mt-1 text-xs text-amber-800">Check: {r.note}</p>}
                    </td>
                    <td className="py-2 pr-2">
                      <select aria-label={`Category, product ${i + 1}`} className={cell} value={r.categoryId} onChange={(e) => set(r.key, { categoryId: e.target.value })}>
                        <option value="">Choose…</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {!r.categoryId && r.newCategory && (
                        <button className="mt-1 text-xs font-semibold text-brand-700 hover:underline" onClick={() => void addCategory(r)}>
                          + Create category “{r.newCategory}”
                        </button>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <input aria-label={`Counted in, product ${i + 1}`} placeholder="pcs" className={cell} value={r.baseUnit} onChange={(e) => set(r.key, { baseUnit: e.target.value })} />
                    </td>
                    <td className="py-2 pr-2">
                      <input aria-label={`Pack unit, product ${i + 1}`} placeholder="box" className={cell} value={r.packUnit} onChange={(e) => set(r.key, { packUnit: e.target.value })} />
                    </td>
                    <td className="py-2 pr-2">
                      <input aria-label={`Units per pack, product ${i + 1}`} inputMode="numeric" className={cell} value={r.perPack} onChange={(e) => set(r.key, { perPack: e.target.value })} />
                    </td>
                    <td className="py-2">
                      <span className="flex gap-1.5">
                        <TempInput aria-label={`Lowest °C, product ${i + 1}`} className={cell} value={r.min} onChange={(min) => set(r.key, { min })} />
                        <TempInput aria-label={`Highest °C, product ${i + 1}`} className={cell} value={r.max} onChange={(max) => set(r.key, { max })} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">Leave both temperatures empty to use the category's range. Stock starts at 0.</p>
        </>
      )}

      <ErrorNote message={error} />
      {rows.length > 0 && (
        <button className={primaryButton} disabled={busy !== ""} onClick={() => void save()}>
          Add {rows.filter((r) => r.include).length} selected products
        </button>
      )}
    </section>
  );
}
