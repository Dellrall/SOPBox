import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import DeliveryLines from "./DeliveryLines";
import { imageToJpegBase64 } from "./image";
import type { Delivery, Product } from "./types";
import {
  Empty,
  ErrorNote,
  StatusBadge,
  cardClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "./ui";

type Draft = {
  key: number;
  productId: number | null;
  name: string; // as written on the order
  quantity: string;
  unit: string;
  temp: string;
  expected: string; // expected quantity in base units, optional
};

let nextKey = 1;
const blankLine = (): Draft => ({
  key: nextKey++,
  productId: null,
  name: "",
  quantity: "",
  unit: "",
  temp: "",
  expected: "",
});

const unitsFor = (p?: Product): string[] => (p ? [p.base_unit, ...p.pack_units.map((u) => u.unit)] : []);
const matchUnit = (p: Product | undefined, unit: string): string =>
  unitsFor(p).find((u) => u.toLowerCase() === unit.trim().toLowerCase()) ?? "";
const optionalNumber = (text: string): number | null => (text.trim() === "" ? null : Number(text));
const rangeHint = (p?: Product): string =>
  p && p.effective_temp_min_c !== null
    ? `Required: ${p.effective_temp_min_c} to ${p.effective_temp_max_c} °C`
    : "";

export default function Receive({ active }: { active: boolean }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState<Draft[]>([blankLine()]);
  const [busy, setBusy] = useState<"" | "reading" | "submitting">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<Delivery | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  // Receive stays mounted while you look at other pages, so reload the catalogue each time it is
  // opened: a manager may have added products or a delivery may have changed the stock.
  useEffect(() => {
    if (!active) return;
    api
      .products()
      .then((found) => {
        setProducts(found);
        setError("");
      })
      .catch((e: Error) => setError(`Could not load the catalogue: ${e.message}`))
      .finally(() => setLoaded(true));
  }, [active]);

  const update = (key: number, patch: Partial<Draft>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function chooseProduct(line: Draft, value: string) {
    const productId = value === "" ? null : Number(value);
    const product = products.find((p) => p.id === productId);
    // Keep the unit only if the new product has it.
    update(line.key, { productId, unit: product ? matchUnit(product, line.unit) : line.unit });
  }

  async function readPhoto(file: File) {
    setBusy("reading");
    setError("");
    setNotice("");
    try {
      const extracted = await api.extract(await imageToJpegBase64(file));
      if (extracted.length === 0) {
        setNotice("No lines were found on the photo. Add them by hand.");
        return;
      }
      setLines(
        extracted.map((l) => {
          const product = products.find((p) => p.id === l.product_id);
          return {
            ...blankLine(),
            productId: l.product_id,
            name: l.name,
            quantity: String(l.quantity),
            unit: product ? matchUnit(product, l.unit) : l.unit,
          };
        }),
      );
      setNotice("Read from the photo. Check every line before you submit.");
    } catch (e) {
      setError(`${(e as Error).message}. Add the lines by hand.`);
    } finally {
      setBusy("");
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  async function submit() {
    setError("");

    const payload = [];
    for (const [i, l] of lines.entries()) {
      const product = products.find((p) => p.id === l.productId);
      const name = l.name.trim() || product?.name || "";
      const quantity = Number(l.quantity);
      const temp = optionalNumber(l.temp);
      const expected = optionalNumber(l.expected);
      if (!name) return setError(`Line ${i + 1}: choose a product or type its name.`);
      if (!Number.isInteger(quantity) || quantity <= 0)
        return setError(`Line ${i + 1}: quantity must be a whole number above 0.`);
      if (!l.unit.trim()) return setError(`Line ${i + 1}: choose a unit.`);
      if (temp !== null && Number.isNaN(temp)) return setError(`Line ${i + 1}: temperature must be a number.`);
      if (expected !== null && (!Number.isInteger(expected) || expected <= 0))
        return setError(`Line ${i + 1}: expected quantity must be a whole number above 0.`);
      payload.push({
        product_id: l.productId,
        name,
        quantity,
        unit: l.unit.trim(),
        temp_c: temp,
        expected_base_qty: expected,
      });
    }

    setBusy("submitting");
    try {
      setResult(
        await api.createDelivery({ supplier: supplier.trim(), lines: payload }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function startAnother() {
    setResult(null);
    setLines([blankLine()]);
    setSupplier("");
    setNotice("");
    setError("");
  }

  if (result) {
    return (
      <section className={`${cardClass} space-y-3`} aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Delivery #{result.id}</h2>
          <StatusBadge status={result.status} />
        </div>
        <p className="text-sm text-slate-700">
          {result.status === "accepted"
            ? "Every check passed. Stock is updated."
            : "A manager must decide before this stock is counted. They have been alerted."}
        </p>
        <DeliveryLines lines={result.lines} />
        <button className={primaryButton} onClick={startAnother}>
          Receive another delivery
        </button>
      </section>
    );
  }

  if (loaded && products.length === 0 && !error) {
    return (
      <Empty>
        There are no products yet, so deliveries cannot be checked. A manager needs to add products
        under Products &amp; SOP first.
      </Empty>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <label className={labelClass} htmlFor="supplier">
          Supplier (optional)
        </label>
        <input id="supplier" className={inputClass} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
      </div>

      <div className={`${cardClass} space-y-2`}>
        <p className="text-sm text-slate-700">
          Take a photo of the delivery order and the lines fill in. You can also type them.
        </p>
        <input
          ref={photoInput}
          id="order-photo"
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => e.target.files?.[0] && void readPhoto(e.target.files[0])}
        />
        <label
          htmlFor="order-photo"
          className={`${secondaryButton} inline-block cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}
        >
          {busy === "reading" ? "Reading the order…" : "Photograph the order"}
        </label>
        {notice && <p className="text-sm text-brand-900">{notice}</p>}
      </div>

      {lines.map((line, i) => {
        const product = products.find((p) => p.id === line.productId);
        const units = unitsFor(product);
        const hint = rangeHint(product);
        return (
          <fieldset key={line.key} className={`${cardClass} space-y-3`}>
            <legend className="px-1 text-sm font-semibold text-slate-700">Line {i + 1}</legend>
            <div>
              <label className={labelClass} htmlFor={`product-${line.key}`}>
                Product
              </label>
              <select
                id={`product-${line.key}`}
                className={inputClass}
                value={line.productId ?? ""}
                onChange={(e) => chooseProduct(line, e.target.value)}
              >
                <option value="">Not in the catalogue</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {!product && (
              <div>
                <label className={labelClass} htmlFor={`name-${line.key}`}>
                  Name on the order
                </label>
                <input id={`name-${line.key}`} className={inputClass} value={line.name} onChange={(e) => update(line.key, { name: e.target.value })} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor={`qty-${line.key}`}>
                  Quantity
                </label>
                <input id={`qty-${line.key}`} className={inputClass} inputMode="numeric" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />
              </div>
              <div>
                <label className={labelClass} htmlFor={`unit-${line.key}`}>
                  Unit
                </label>
                {product ? (
                  <select id={`unit-${line.key}`} className={inputClass} value={line.unit} onChange={(e) => update(line.key, { unit: e.target.value })}>
                    <option value="">Choose…</option>
                    {units.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input id={`unit-${line.key}`} className={inputClass} value={line.unit} onChange={(e) => update(line.key, { unit: e.target.value })} />
                )}
              </div>
              <div>
                <label className={labelClass} htmlFor={`temp-${line.key}`}>
                  Probe temperature (°C)
                </label>
                <input id={`temp-${line.key}`} className={inputClass} inputMode="decimal" value={line.temp} onChange={(e) => update(line.key, { temp: e.target.value })} />
                {hint && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
              </div>
              <div>
                <label className={labelClass} htmlFor={`expected-${line.key}`}>
                  Ordered (base units)
                </label>
                <input id={`expected-${line.key}`} className={inputClass} inputMode="numeric" value={line.expected} onChange={(e) => update(line.key, { expected: e.target.value })} />
                {product && <p className="mt-1 text-xs text-slate-600">Counted in {product.base_unit}</p>}
              </div>
            </div>
            {lines.length > 1 && (
              <button type="button" className="text-sm text-red-800 underline" onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}>
                Remove line {i + 1}
              </button>
            )}
          </fieldset>
        );
      })}

      <button type="button" className={secondaryButton} onClick={() => setLines((all) => [...all, blankLine()])}>
        Add a line
      </button>

      <ErrorNote message={error} />

      <button type="submit" className={`${primaryButton} w-full`} disabled={busy !== ""}>
        {busy === "submitting" ? "Checking…" : "Check and submit delivery"}
      </button>
    </form>
  );
}
