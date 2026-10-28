import { useState } from "react";
import { api } from "./api";
import SopWriter from "./SopWriter";
import type { Category, PackUnit, Product, ProductIn } from "./types";
import { ErrorNote, TempInput, cardClass, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

const num = (text: string): number | null => (text.trim() === "" ? null : Number(text));

/** Create or edit a product: its unit, pack sizes, temperature rule, minimum stock and SOP. */
export default function ProductForm({
  product,
  categories,
  onSaved,
  onCancel,
}: {
  product?: Product;
  categories: Category[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [categoryId, setCategoryId] = useState(String(product?.category_id ?? categories[0]?.id ?? ""));
  const [baseUnit, setBaseUnit] = useState(product?.base_unit ?? "");
  const [minStock, setMinStock] = useState(String(product?.min_stock ?? 0));
  const [code, setCode] = useState(product?.code ?? "");
  const [tempMin, setTempMin] = useState(product?.temp_min_c?.toString() ?? "");
  const [tempMax, setTempMax] = useState(product?.temp_max_c?.toString() ?? "");
  const [packs, setPacks] = useState<{ unit: string; qty: string }[]>(
    (product?.pack_units ?? []).map((p) => ({ unit: p.unit, qty: String(p.base_qty) })),
  );
  const [sop, setSop] = useState(product?.sop ?? "");
  // The form can open before its categories load, or keep an id that was since deleted. Fall back
  // to the first category, which is what the dropdown shows anyway.
  const selectedCategory = categories.some((c) => String(c.id) === categoryId)
    ? categoryId
    : String(categories[0]?.id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  /** The product as typed, checked; or what to fix. Saving and the SOP writer both use it. */
  function checked(): Omit<ProductIn, "sop"> | string {
    const low = num(tempMin);
    const high = num(tempMax);
    const stockMin = Number(minStock);
    if (!name.trim()) return "Enter the product name.";
    if (!baseUnit.trim()) return "Enter the unit it is counted in.";
    if (!selectedCategory) return "Choose a category. Add one first if the list is empty.";
    if ((low === null) !== (high === null)) return "Fill in both temperatures, or leave both empty.";
    if ((low !== null && Number.isNaN(low)) || (high !== null && Number.isNaN(high))) return "Temperatures must be numbers.";
    if (!Number.isInteger(stockMin) || stockMin < 0) return "Minimum stock must be a whole number, 0 or more.";
    const packUnits: PackUnit[] = [];
    for (const p of packs) {
      if (!p.unit.trim() && !p.qty.trim()) continue; // a blank row the user added but did not fill
      const qty = Number(p.qty);
      if (!p.unit.trim() || !Number.isInteger(qty) || qty <= 0)
        return "Each pack size needs a unit name and a whole number of base units above 0.";
      packUnits.push({ unit: p.unit.trim(), base_qty: qty });
    }
    return {
      name: name.trim(),
      category_id: Number(selectedCategory),
      base_unit: baseUnit.trim(),
      temp_min_c: low,
      temp_max_c: high,
      min_stock: stockMin,
      pack_units: packUnits,
      code: code.trim() || null,
    };
  }

  async function save() {
    const rules = checked();
    if (typeof rules === "string") return setError(rules);
    setBusy(true);
    setError("");
    const body = { ...rules, sop: sop.trim() };
    try {
      if (product) await api.updateProduct(product.id, body);
      else await api.createProduct(body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form
      className={`${cardClass} space-y-4`}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 className="text-base font-bold text-brand-950">{product ? `Edit ${product.name}` : "Add a product"}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="p-name">
            Name
          </label>
          <input id="p-name" required maxLength={120} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="p-category">
            Category
          </label>
          <select id="p-category" className={inputClass} value={selectedCategory} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.length === 0 && <option value="">No categories yet</option>}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="p-unit">
            Counted in (base unit)
          </label>
          <input id="p-unit" required maxLength={20} placeholder="pcs, kg, box…" className={inputClass} value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="p-min">
            Low-stock level (base units)
          </label>
          <input id="p-min" inputMode="numeric" className={inputClass} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          <p className="mt-1 text-xs text-slate-600">0 turns the low-stock flag off.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="p-code">
            Product code (optional)
          </label>
          <input id="p-code" maxLength={40} placeholder="SKU on your POS" className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} />
          <p className="mt-1 text-xs text-slate-600">Uploaded sales are matched by this code.</p>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">Own temperature range (optional)</legend>
        <div className="grid grid-cols-2 gap-3">
          <TempInput aria-label="Lowest temperature in °C" placeholder="Lowest °C" value={tempMin} onChange={setTempMin} />
          <TempInput aria-label="Highest temperature in °C" placeholder="Highest °C" value={tempMax} onChange={setTempMax} />
        </div>
        <p className="text-xs text-slate-600">Leave empty to use the category&apos;s range.</p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">Pack sizes</legend>
        {packs.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input aria-label={`Pack ${i + 1} unit`} placeholder="Unit, e.g. bdl" className={`${inputClass} sm:w-40`} value={p.unit} onChange={(e) => setPacks((all) => all.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
            <span className="text-sm text-slate-600">=</span>
            <input aria-label={`Pack ${i + 1} base units`} inputMode="numeric" placeholder="Base units" className={`${inputClass} sm:w-40`} value={p.qty} onChange={(e) => setPacks((all) => all.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
            <button type="button" className="text-sm text-red-800 underline" onClick={() => setPacks((all) => all.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className={secondaryButton} onClick={() => setPacks((all) => [...all, { unit: "", qty: "" }])}>
          Add a pack size
        </button>
        <p className="text-xs text-slate-600">For example: 1 bdl = 250 pcs. Deliveries are converted to base units.</p>
      </fieldset>

      <div>
        <label className={labelClass} htmlFor="p-sop">
          SOP (how to receive, store and handle it)
        </label>
        <textarea id="p-sop" rows={sop.split("\n").length > 4 ? 8 : 4} maxLength={4000} className={inputClass} value={sop} onChange={(e) => setSop(e.target.value)} />
        <SopWriter rules={checked} onUse={setSop} />
      </div>

      <ErrorNote message={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Saving…" : "Save product"}
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
