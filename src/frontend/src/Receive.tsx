import { useEffect, useRef, useState } from "react";
import { useMascot, type Scene } from "./Mascot";
import { Camera, Loader2 } from "lucide-react";
import { api } from "./api";
import DeliveryLines from "./DeliveryLines";
import { imageToJpegBase64 } from "./image";
import type { Delivery, Product, PurchaseOrder } from "./types";
import {
  Empty,
  ErrorNote,
  PageTitle,
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
  note: string; // what the AI flagged on this line, for staff to check
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
  note: "",
});

const unitsFor = (p?: Product): string[] => (p ? [p.base_unit, ...p.pack_units.map((u) => u.unit)] : []);
const matchUnit = (p: Product | undefined, unit: string): string =>
  unitsFor(p).find((u) => u.toLowerCase() === unit.trim().toLowerCase()) ?? "";
const optionalNumber = (text: string): number | null => (text.trim() === "" ? null : Number(text));
const rangeHint = (p?: Product): string =>
  p && p.effective_temp_min_c !== null
    ? `Required: ${p.effective_temp_min_c} to ${p.effective_temp_max_c} °C`
    : "";

export default function Receive({
  active,
  canEdit,
  purchaseOrderId,
  onPurchaseOrderTaken,
}: {
  active: boolean;
  canEdit: boolean;
  purchaseOrderId?: number | null; // preselect this order, from its "Receive a delivery" button
  onPurchaseOrderTaken?: () => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [orderId, setOrderId] = useState<number | null>(null);
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
    Promise.all([api.products(), api.purchaseOrders("issued")])
      .then(([found, issued]) => {
        setProducts(found.filter((p) => !p.archived)); // archived products are not received
        setOrders(issued.filter((o) => o.receiving_status !== "fully_received"));
        setError("");
      })
      .catch((e: Error) => setError(`Could not load the catalogue: ${e.message}`))
      .finally(() => setLoaded(true));
  }, [active]);

  // Fill the lines with what is still to come on the order, in the units it was ordered in.
  function fillFromOrder(order: PurchaseOrder | undefined) {
    setOrderId(order?.id ?? null);
    if (!order) return;
    setSupplier(order.supplier);
    const toCome = order.lines.filter((l) => l.outstanding_base_qty > 0);
    setLines(
      toCome.map((l) => {
        const perUnit = l.ordered_base_qty / l.quantity;
        const inOrderedUnit = l.outstanding_base_qty % perUnit === 0;
        return {
          ...blankLine(),
          productId: l.product_id,
          name: l.product_name,
          quantity: String(inOrderedUnit ? l.outstanding_base_qty / perUnit : l.outstanding_base_qty),
          unit: inOrderedUnit ? l.unit : l.base_unit,
          expected: String(l.outstanding_base_qty),
        };
      }),
    );
    setNotice(`Filled from ${order.reference}. Change the quantities to what actually arrived, and add each temperature.`);
  }

  useEffect(() => {
    // The list may still be the one from the last visit; wait until it includes the order.
    const order = purchaseOrderId ? orders.find((o) => o.id === purchaseOrderId) : undefined;
    if (!order) return;
    fillFromOrder(order);
    onPurchaseOrderTaken?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrderId, orders]);

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
            quantity: l.quantity === null ? "" : String(l.quantity),
            unit: l.unit === null ? "" : product ? matchUnit(product, l.unit) : l.unit,
            // The model's own note says why; the generic reasons only fill in when it gave none.
            note:
              l.warning ??
              [l.quantity === null ? "quantity could not be read" : null, l.unit === null ? "unit could not be read" : null]
                .filter(Boolean)
                .join("; "),
          };
        }),
      );
      const flagged = extracted.filter((l) => l.warning || l.quantity === null || l.unit === null).length;
      setNotice(
        flagged
          ? `Read from the photo. ${flagged} ${flagged === 1 ? "line needs" : "lines need"} your attention (marked below). Check every line before you submit.`
          : "Read from the photo. Check every line before you submit.",
      );
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
        await api.createDelivery({ supplier: supplier.trim(), purchase_order_id: orderId, lines: payload }),
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
    setOrderId(null);
    setNotice("");
    setError("");
  }

  const filled = lines.filter((l) => (l.productId || l.name.trim()) && l.quantity.trim() && l.unit.trim()).length;
  const held = result ? result.lines.filter((l) => !l.passed).length : 0;
  const scene: Scene | null =
    busy === "reading"
      ? { who: "fish", action: "read", text: "Reading the delivery order… (up to a few minutes if the AI was asleep)" }
      : busy === "submitting"
        ? { who: "carrot", action: "probe", text: `Checking ${lines.length} ${lines.length === 1 ? "line" : "lines"}: temperature, quantity, pack size…` }
        : result
          ? result.status === "accepted"
            ? { who: "crew", action: "cheer", text: `Delivery #${result.id} passed every check. Stock updated!` }
            : { who: "carrot", action: "worry", text: `${held} ${held === 1 ? "line needs" : "lines need"} a manager. I've told them.` }
          : filled > 0
            ? { who: "cabbage", action: "carry", text: `${filled} of ${lines.length} ${lines.length === 1 ? "line" : "lines"} ready. Probe the cold items before you submit.`, progress: filled / lines.length }
            : null;
  // This page stays mounted (hidden) to keep unsaved work, so it only speaks while it is shown.
  useMascot(active ? scene : null);

  const title = <PageTitle title="Receiving check" subtitle="Record a delivery as it arrives. Each line is checked against its product's rules." />;

  if (!canEdit) {
    return (
      <div>
        {title}
        <section className={`${cardClass} max-w-2xl space-y-2`}>
          <h2 className="font-semibold text-brand-950">View-only access</h2>
          <p className="text-sm text-muted">
            You can review the catalogue and issued purchase orders here, but you cannot record a delivery.
            Ask the owner to grant “Edit + add” access if you need to receive stock.
          </p>
          {orders.length > 0 && (
            <p className="text-sm text-ink">
              {orders.length} issued {orders.length === 1 ? "purchase order is" : "purchase orders are"} available to review.
            </p>
          )}
        </section>
      </div>
    );
  }


  if (result) {
    return (
      <section className={`${cardClass} space-y-3`} aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-brand-950">Delivery #{result.id}
            {result.purchase_order && ` · ${result.purchase_order}`}
          </h2>
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
      <div>
        {title}
        <Empty>
          There are no products yet, so deliveries cannot be checked. A manager needs to add products
          under Products &amp; SOP first.
        </Empty>
      </div>
    );
  }

  return (
    <div>
      {title}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {orders.length > 0 && (
          <div>
            <label className={labelClass} htmlFor="purchase-order">
              Purchase order <span className="font-normal text-muted">(optional)</span>
            </label>
            <select
              id="purchase-order"
              className={inputClass}
              value={orderId ?? ""}
              onChange={(e) => fillFromOrder(orders.find((o) => o.id === Number(e.target.value)))}
            >
              <option value="">No purchase order</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.reference} · {o.supplier}
                </option>
              ))}
            </select>
            {orderId !== null && (
              <p className="mt-1 text-xs text-muted">
                Each line is checked against what is still to come on this order. Products not on it go to a manager.
              </p>
            )}
          </div>
        )}
        <div>
          <label className={labelClass} htmlFor="supplier">
            Supplier (optional)
          </label>
          <input id="supplier" className={inputClass} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </div>

        <div className="rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50/60 p-5 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-sm">
            <Camera aria-hidden className="h-6 w-6" />
          </span>
          <p className="mx-auto mt-3 max-w-sm text-sm text-slate-700">
            Take a photo of the delivery order and the lines fill in for you to confirm. You can also type them below.
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
            className={`${primaryButton} mt-4 cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            {busy === "reading" ? (
              <>
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Reading the order… (up to 3 min if the reader was asleep)
              </>
            ) : (
              <>
                <Camera aria-hidden className="h-4 w-4" /> Photograph the order
              </>
            )}
          </label>
          {notice && <p className="mt-3 text-sm text-brand-900">{notice}</p>}
        </div>

        {lines.map((line, i) => {
          const product = products.find((p) => p.id === line.productId);
          const units = unitsFor(product);
          const hint = rangeHint(product);
          return (
            <fieldset key={line.key} className={`${cardClass} space-y-3`}>
              <legend className="px-1 text-sm font-semibold text-slate-700">Line {i + 1}</legend>
              {line.note && (
                <p role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <strong>Check this line:</strong> {line.note}
                </p>
              )}
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

        <ErrorNote message={active ? error : ""} />

        <button type="submit" className={`${primaryButton} w-full`} disabled={busy !== ""}>
          {busy === "submitting" ? "Checking…" : "Check and submit delivery"}
        </button>
      </form>
    </div>
  );
}
