import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, ChevronDown, FilePlus2, Search, PackageCheck, Plus, Printer, Send, Sparkles, Trash2, Truck, XCircle } from "lucide-react";
import { api } from "./api";
import SearchSelect from "./SearchSelect";
import type { LowStockSupplier, Product, ReorderSuggestion, PurchaseOrder, PurchaseOrderIn, PurchaseOrderStatus, ReceivingStatus, Supplier, SupplierIn } from "./types";
import {
  Empty,
  ErrorNote,
  PageTitle,
  SectionTitle,
  SuccessNote,
  cardClass,
  dangerButton,
  inputClass,
  labelClass,
  panelClass,
  primaryButton,
  secondaryButton,
  when,
} from "./ui";
import { Select } from "./Select";

const STATUS_STYLE: Record<PurchaseOrderStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-500/20",
  issued: "bg-sky-50 text-sky-800 ring-sky-600/20",
  cancelled: "bg-red-50 text-red-800 ring-red-600/20",
};
const RECEIVING_LABEL: Record<ReceivingStatus, string> = {
  not_received: "Nothing received yet",
  partially_received: "Partly received",
  fully_received: "Fully received",
};

function OrderBadges({ order }: { order: PurchaseOrder }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${STATUS_STYLE[order.status]}`}>
        {order.status}
      </span>
      {order.status === "issued" && (
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
            order.receiving_status === "fully_received"
              ? "bg-emerald-50 text-emerald-800 ring-emerald-600/20"
              : order.receiving_status === "partially_received"
                ? "bg-amber-50 text-amber-800 ring-amber-600/20"
                : "bg-white text-slate-600 ring-slate-300"
          }`}
        >
          {RECEIVING_LABEL[order.receiving_status]}
        </span>
      )}
    </span>
  );
}

// The local date (en-CA formats as YYYY-MM-DD). toISOString would give the UTC date, which in
// Malaysia is still yesterday until 08:00.
const today = () => new Date().toLocaleDateString("en-CA");

// ---- suppliers ----------------------------------------------------------------------------------

const BLANK_SUPPLIER: SupplierIn = { name: "", contact: "", phone: "", email: "", product_ids: [] };

/** Pick the products a supplier sells: search by product or category, or tick a whole category. */
function SupplierProducts({
  id,
  products,
  value,
  onChange,
}: {
  id: string;
  products: Product[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const [query, setQuery] = useState("");
  const chosen = new Set(value);
  const q = query.trim().toLowerCase();
  const shown = products.filter(
    (p) => (!p.archived || chosen.has(p.id)) && (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)),
  );
  const groups = new Map<string, Product[]>();
  for (const p of shown) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
  const toggle = (ids: number[], on: boolean) => {
    const next = new Set(value);
    ids.forEach((pid) => (on ? next.add(pid) : next.delete(pid)));
    onChange([...next]);
  };

  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className={labelClass}>
        Products they supply <span className="font-normal text-muted">({value.length} chosen)</span>
      </legend>
      <label className="sr-only" htmlFor={`${id}-find`}>
        Find a product or category
      </label>
      <input
        id={`${id}-find`}
        type="search"
        placeholder="Type a product or category…"
        className={inputClass}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {products.length === 0 ? (
        <p className="text-sm text-muted">Add products under Products &amp; SOP first.</p>
      ) : groups.size === 0 ? (
        <p className="text-sm text-muted">No product or category matches “{query}”.</p>
      ) : (
        <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-line bg-white p-3">
          {[...groups].map(([category, items]) => {
            const all = items.every((p) => chosen.has(p.id));
            return (
              <div key={category}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{category}</h4>
                  <button
                    type="button"
                    className="text-xs font-semibold text-brand-700 hover:underline"
                    onClick={() => toggle(items.map((p) => p.id), !all)}
                  >
                    {all ? "Clear" : "Select all"}
                    <span className="sr-only"> in {category}</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((p) => {
                    const on = chosen.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle([p.id], !on)}
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                          on ? "bg-brand-600 text-white" : "bg-slate-50 text-slate-700 ring-1 ring-line hover:bg-slate-100"
                        }`}
                      >
                        {on && <Check aria-hidden className="h-3.5 w-3.5" />}
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

/** Supplier details and products: opens under the supplier being edited, or at the bottom to add one. */
function SupplierForm({
  id,
  initial,
  products,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  id: string;
  initial: SupplierIn;
  products: Product[];
  submitLabel: string;
  onSubmit: (form: SupplierIn) => Promise<void>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0); // remounts the product picker so its search clears too

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onSubmit(form);
      setForm(initial);
      setSaved((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="grid gap-3 sm:grid-cols-2">
      {(
        [
          ["name", "Supplier name", "text", true],
          ["contact", "Contact person", "text", false],
          ["phone", "Phone", "tel", false],
          ["email", "Email", "email", false],
        ] as const
      ).map(([key, label, type, required]) => (
        <div key={key}>
          <label className={labelClass} htmlFor={`${id}-${key}`}>
            {label}
          </label>
          <input
            id={`${id}-${key}`}
            type={type}
            required={required}
            maxLength={key === "email" ? 254 : 120}
            className={inputClass}
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        </div>
      ))}
      <SupplierProducts key={saved} id={id} products={products} value={form.product_ids} onChange={(product_ids) => setForm({ ...form, product_ids })} />
      <div className="sm:col-span-2">
        <ErrorNote message={error} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={primaryButton} disabled={busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={secondaryButton} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Suppliers({ suppliers, products, onChanged }: { suppliers: Supplier[]; products: Product[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const names = new Map(products.map((p) => [p.id, p.name]));
  // Matches the name, contact details, or anything they supply ("who sells Coke?").
  const q = query.trim().toLowerCase();
  const shown = q
    ? suppliers.filter((s) =>
        [s.name, s.contact, s.phone, s.email, ...s.product_ids.map((pid) => names.get(pid) ?? "")].some((t) => t.toLowerCase().includes(q)),
      )
    : suppliers;

  async function archive(s: Supplier) {
    try {
      await api.setSupplierArchived(s.id, !s.archived);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className={`${cardClass} space-y-4`}>
      <SectionTitle>Suppliers</SectionTitle>
      <ErrorNote message={error} />
      {suppliers.length > 0 && (
        <div className="relative">
          <label className="sr-only" htmlFor="supplier-search">
            Search suppliers
          </label>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id="supplier-search"
            type="search"
            placeholder="Search by supplier, contact or product…"
            className={`${inputClass} pl-9`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {q && shown.length === 0 && <p className="text-sm text-muted">No supplier matches “{query}”.</p>}
      {shown.length > 0 && (
        <ul className="divide-y divide-line">
          {shown.map((s) => {
            const open = editing === s.id;
            const sells = s.product_ids.map((pid) => names.get(pid)).filter(Boolean) as string[];
            return (
              <li key={s.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className={`font-semibold ${s.archived ? "text-muted line-through" : ""}`}>{s.name}</span>
                    <span className="block text-sm text-muted">
                      {[s.contact, s.phone, s.email].filter(Boolean).join(" · ") || "No contact details"}
                    </span>
                    {sells.length > 0 && (
                      <span className="mt-1 block text-sm text-slate-700">
                        Supplies {sells.slice(0, 4).join(", ")}
                        {sells.length > 4 && ` +${sells.length - 4} more`}
                      </span>
                    )}
                  </span>
                  <span className="flex gap-2">
                    <button
                      className={secondaryButton}
                      aria-expanded={open}
                      onClick={() => setEditing(open ? null : s.id)}
                    >
                      {open ? "Close" : "Edit"}
                      <ChevronDown aria-hidden className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
                    </button>
                    <button className={secondaryButton} onClick={() => void archive(s)}>
                      {s.archived ? "Restore" : "Archive"}
                    </button>
                  </span>
                </div>
                {open && (
                  <div className="mt-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-4">
                    <SupplierForm
                      id={`supplier-${s.id}`}
                      initial={{ name: s.name, contact: s.contact, phone: s.phone, email: s.email, product_ids: s.product_ids }}
                      products={products}
                      submitLabel="Save supplier"
                      onSubmit={async (form) => {
                        await api.updateSupplier(s.id, form);
                        setEditing(null);
                        onChanged();
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {/* Folded once there are suppliers, so the form does not push the list off a phone screen. */}
      <details open={suppliers.length === 0} className="group space-y-3 border-t border-line pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-brand-950">
          <h3>Add a supplier</h3>
          <ChevronDown aria-hidden className="h-4 w-4 transition group-open:rotate-180" />
        </summary>
        <SupplierForm
          id="supplier-new"
          initial={BLANK_SUPPLIER}
          products={products}
          submitLabel="Add supplier"
          onSubmit={async (form) => {
            await api.createSupplier(form);
            onChanged();
          }}
        />
      </details>
    </section>
  );
}

// ---- the order form -----------------------------------------------------------------------------

type LineDraft = { key: number; productId: string; quantity: string; unit: string };
let nextKey = 1;

function OrderForm({
  order,
  suppliers,
  products,
  onSaved,
  onCancel,
}: {
  order: PurchaseOrder | null;
  suppliers: Supplier[];
  products: Product[];
  onSaved: (order: PurchaseOrder) => void;
  onCancel: () => void;
}) {
  const active = suppliers.filter((s) => !s.archived);
  const [supplierId, setSupplierId] = useState(String(order?.supplier_id ?? active[0]?.id ?? ""));
  // The form can appear before the suppliers have loaded. Fall back to the first active one,
  // which is what the dropdown shows, rather than sending no supplier.
  const chosenSupplier = active.some((s) => String(s.id) === supplierId) ? supplierId : String(active[0]?.id ?? "");
  const [orderDate, setOrderDate] = useState(order?.order_date ?? today());
  const [expectedDate, setExpectedDate] = useState(order?.expected_date ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    order?.lines.map((l) => ({ key: nextKey++, productId: String(l.product_id), quantity: String(l.quantity), unit: l.unit })) ?? [
      { key: nextKey++, productId: "", quantity: "", unit: "" },
    ],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const unitsOf = (id: string) => {
    const p = products.find((x) => String(x.id) === id);
    return p ? [p.base_unit, ...p.pack_units.map((u) => u.unit)] : [];
  };
  const setLine = (key: number, patch: Partial<LineDraft>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    const body: PurchaseOrderIn = {
      supplier_id: Number(chosenSupplier),
      order_date: orderDate,
      expected_date: expectedDate || null,
      notes: notes.trim(),
      lines: [],
    };
    for (const [i, l] of lines.entries()) {
      const quantity = Number(l.quantity);
      if (!l.productId) return setError(`Line ${i + 1}: choose a product.`);
      if (!Number.isInteger(quantity) || quantity <= 0) return setError(`Line ${i + 1}: quantity must be a whole number above 0.`);
      body.lines.push({ product_id: Number(l.productId), quantity, unit: l.unit || unitsOf(l.productId)[0] });
    }
    setBusy(true);
    try {
      onSaved(order ? await api.updatePurchaseOrder(order.id, body) : await api.createPurchaseOrder(body));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (active.length === 0) {
    return <Empty>Add a supplier below first, then create the purchase order.</Empty>;
  }

  return (
    <form onSubmit={(e) => void save(e)} className={`${cardClass} space-y-4`}>
      <SectionTitle>{order ? `Edit ${order.reference}` : "New purchase order"}</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="po-supplier">
            Supplier
          </label>
          <SearchSelect
            id="po-supplier"
            noun="suppliers"
            options={active.map((s) => ({ value: String(s.id), label: s.name }))}
            value={chosenSupplier}
            onChange={setSupplierId}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="po-date">
            Order date
          </label>
          <input id="po-date" type="date" required className={inputClass} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor="po-expected">
            Expected delivery <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="po-expected" type="date" min={orderDate} className={inputClass} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className={labelClass}>What to order</legend>
        {lines.map((l, i) => {
          const units = unitsOf(l.productId);
          return (
            // Phone: product on its own row so its name is readable, quantity and unit below.
            <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_6rem_auto]">
              <div className="col-span-3 sm:col-span-1">
                <label className="sr-only" htmlFor={`po-product-${l.key}`}>
                  Product, line {i + 1}
                </label>
                <SearchSelect
                  id={`po-product-${l.key}`}
                  noun="products"
                  placeholder="Choose a product"
                  options={products.map((p) => ({ value: String(p.id), label: p.name, group: p.category }))}
                  value={l.productId}
                  onChange={(productId) => setLine(l.key, { productId, unit: unitsOf(productId).slice(-1)[0] ?? "" })}
                />
              </div>
              <div>
                <label className="sr-only" htmlFor={`po-qty-${l.key}`}>
                  Quantity, line {i + 1}
                </label>
                <input id={`po-qty-${l.key}`} inputMode="numeric" placeholder="Qty" className={inputClass} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
              </div>
              <div>
                <label className="sr-only" htmlFor={`po-unit-${l.key}`}>
                  Unit, line {i + 1}
                </label>
                <Select
                  id={`po-unit-${l.key}`}
                  className={inputClass}
                  value={l.unit}
                  disabled={!units.length}
                  choices={units.map((u) => ({ value: u, label: u }))}
                  onChange={(v) => setLine(l.key, { unit: v })}
                />
              </div>
              <button
                type="button"
                aria-label={`Remove line ${i + 1}`}
                disabled={lines.length === 1}
                className="rounded-xl p-2.5 text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
                onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}
              >
                <Trash2 aria-hidden className="h-4 w-4" />
              </button>
            </div>
          );
        })}
        <button type="button" className={secondaryButton} onClick={() => setLines((all) => [...all, { key: nextKey++, productId: "", quantity: "", unit: "" }])}>
          <Plus aria-hidden className="h-4 w-4" /> Add a line
        </button>
      </fieldset>

      <div>
        <label className={labelClass} htmlFor="po-notes">
          Notes for the supplier <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id="po-notes" rows={2} maxLength={1000} className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <p className="text-xs text-muted">Quantities only. Record prices from the supplier's invoice.</p>
      <ErrorNote message={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>
          {order ? "Save draft" : "Save as draft"}
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---- one order ----------------------------------------------------------------------------------

function OrderDetail({
  order,
  canEdit,
  canReceiveAccess,
  onBack,
  onEdit,
  onChanged,
  onReceive,
}: {
  order: PurchaseOrder;
  canEdit: boolean;
  canReceiveAccess: boolean;
  onBack: () => void;
  onEdit: () => void;
  onChanged: (order: PurchaseOrder) => void;
  onReceive: (orderId: number) => void;
}) {
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  async function act(fn: () => Promise<PurchaseOrder>) {
    setError("");
    try {
      onChanged(await fn());
      setCancelling(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const canReceive = canReceiveAccess && order.status === "issued" && order.receiving_status !== "fully_received";
  return (
    <div className="space-y-5">
      <button className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline print:hidden" onClick={onBack}>
        <ArrowLeft aria-hidden className="h-4 w-4" /> All purchase orders
      </button>

      <article className={`${cardClass} space-y-5 print:border-0 print:shadow-none`}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted">Purchase order</p>
            <h2 className="text-2xl font-bold text-brand-950">{order.reference}</h2>
          </div>
          <OrderBadges order={order} />
        </header>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Supplier</dt>
            <dd className="font-semibold">{order.supplier}</dd>
          </div>
          <div>
            <dt className="text-muted">Order date</dt>
            <dd className="font-semibold">{order.order_date}</dd>
          </div>
          <div>
            <dt className="text-muted">Expected delivery</dt>
            <dd className="font-semibold">{order.expected_date ?? "Not set"}</dd>
          </div>
        </dl>
        {order.notes && <p className="rounded-xl bg-surface px-4 py-3 text-sm">{order.notes}</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="py-2 pr-3 font-semibold">Product</th>
                <th className="py-2 pr-3 font-semibold">Ordered</th>
                <th className="py-2 pr-3 font-semibold print:hidden">Received</th>
                <th className="py-2 font-semibold print:hidden">Still to come</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2.5 pr-3 font-semibold">{l.product_name}</td>
                  <td className="py-2.5 pr-3">
                    {l.quantity} {l.unit}
                    {l.unit !== l.base_unit && (
                      <span className="block text-xs text-muted">
                        = {l.ordered_base_qty} {l.base_unit}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 print:hidden">
                    {l.received_base_qty} {l.base_unit}
                    {l.pending_base_qty > 0 && (
                      <span className="block text-xs text-amber-800">+{l.pending_base_qty} waiting for a manager</span>
                    )}
                  </td>
                  <td className={`py-2.5 print:hidden ${l.outstanding_base_qty ? "font-semibold" : "text-emerald-700"}`}>
                    {l.outstanding_base_qty ? `${l.outstanding_base_qty} ${l.base_unit}` : "Done"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted">
          Created by {order.created_by} on {when(order.created_at)}
          {order.issued_at && ` · issued by ${order.issued_by} on ${when(order.issued_at)}`}
          {order.cancelled_at && ` · cancelled by ${order.cancelled_by} on ${when(order.cancelled_at)}`}
          {order.delivery_ids.length > 0 && ` · deliveries ${order.delivery_ids.map((d) => `#${d}`).join(", ")}`}
        </p>
      </article>

      <ErrorNote message={error} />
      <div className="flex flex-wrap gap-2 print:hidden">
        {canReceive && (
          <button className={primaryButton} onClick={() => onReceive(order.id)}>
            <Truck aria-hidden className="h-4 w-4" /> Receive a delivery for this order
          </button>
        )}
        {canEdit && order.status === "draft" && (
          <>
            <button className={primaryButton} onClick={() => void act(() => api.issuePurchaseOrder(order.id))}>
              <Send aria-hidden className="h-4 w-4" /> Issue to supplier
            </button>
            <button className={secondaryButton} onClick={onEdit}>
              Edit draft
            </button>
          </>
        )}
        <button className={secondaryButton} onClick={() => window.print()}>
          <Printer aria-hidden className="h-4 w-4" /> Print or save as PDF
        </button>
        {canEdit && order.status !== "cancelled" && order.delivery_ids.length === 0 && (
          <button className={dangerButton} onClick={() => setCancelling((c) => !c)}>
            <XCircle aria-hidden className="h-4 w-4" /> Cancel order
          </button>
        )}
      </div>
      {cancelling && (
        <form
          className={`${cardClass} flex flex-wrap items-end gap-2 print:hidden`}
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api.cancelPurchaseOrder(order.id, reason.trim()));
          }}
        >
          <div className="min-w-56 flex-1">
            <label className={labelClass} htmlFor="po-cancel-reason">
              Why cancel? <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="po-cancel-reason" maxLength={500} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button type="submit" className={dangerButton}>
            Cancel {order.reference}
          </button>
        </form>
      )}
    </div>
  );
}

// ---- the page -----------------------------------------------------------------------------------

type View = { kind: "list" } | { kind: "new" } | { kind: "edit"; order: PurchaseOrder } | { kind: "detail"; order: PurchaseOrder };

export default function PurchaseOrders({
  canEdit,
  canReceive,
  onReceive,
}: {
  canEdit: boolean;
  canReceive: boolean;
  onReceive: (orderId: number) => void;
}) {
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filter, setFilter] = useState<PurchaseOrderStatus | "">("");
  const [view, setView] = useState<View>({ kind: "list" });
  const [draftSupplier, setDraftSupplier] = useState("");
  // Only the suppliers a low-stock draft would order something from.
  const [lowSuppliers, setLowSuppliers] = useState<LowStockSupplier[] | null>(null);
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    Promise.all([api.purchaseOrders(filter || undefined), api.suppliers(), api.products()])
      .then(([o, s, p]) => {
        setOrders(o);
        setSuppliers(s);
        setProducts(p.filter((x) => !x.archived));
        setError("");
      })
      .catch((e: Error) => setError(e.message));
    if (canEdit) {
      api.lowStockSuppliers().then(setLowSuppliers).catch(() => setLowSuppliers(null));
      api.reorderSuggestions().then(setSuggestions).catch(() => setSuggestions([]));
    }
  }, [filter, canEdit]);
  useEffect(load, [load]);

  const open = (order: PurchaseOrder) => {
    setNotice("");
    setView({ kind: "detail", order });
    load();
  };

  async function draftFromLowStock() {
    setError("");
    setNotice("");
    try {
      const made = await api.lowStockDraft(Number(chosenLow?.supplier_id), today());
      open(made); // clears the notice, so set it after
      setNotice(`${made.reference} drafted from low stock. Check it, then issue it.`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (view.kind === "detail") {
    return (
      <div>
        <div className="print:hidden">
          <PageTitle title="Purchase orders" />
        </div>
        {notice && (
          <div className="mb-4">
            <SuccessNote>{notice}</SuccessNote>
          </div>
        )}
        <OrderDetail
          order={view.order}
          canEdit={canEdit}
          canReceiveAccess={canReceive}
          onBack={() => setView({ kind: "list" })}
          onEdit={() => setView({ kind: "edit", order: view.order })}
          onChanged={(o) => {
            setNotice("");
            setView({ kind: "detail", order: o });
            load();
          }}
          onReceive={onReceive}
        />
      </div>
    );
  }

  if (view.kind === "new" || view.kind === "edit") {
    return (
      <div>
        <PageTitle title="Purchase orders" />
        <OrderForm
          order={view.kind === "edit" ? view.order : null}
          suppliers={suppliers}
          products={products}
          onSaved={open}
          onCancel={() => setView(view.kind === "edit" ? { kind: "detail", order: view.order } : { kind: "list" })}
        />
        {view.kind === "new" && (
          <div className="mt-5">
            <Suppliers suppliers={suppliers} products={products} onChanged={load} />
          </div>
        )}
      </div>
    );
  }

  const activeSuppliers = suppliers.filter((s) => !s.archived);
  const chosenLow = lowSuppliers?.find((s) => String(s.supplier_id) === draftSupplier) ?? lowSuppliers?.[0];
  return (
    <div className="space-y-5">
      <PageTitle title="Purchase orders" subtitle="What you ordered from each supplier, and how much of it has arrived. Quantities only.">
        {canEdit && (
          <button className={primaryButton} aria-label="New purchase order" onClick={() => setView({ kind: "new" })}>
            <FilePlus2 aria-hidden className="h-4 w-4" /> New<span className="hidden sm:inline"> purchase order</span>
          </button>
        )}
      </PageTitle>

      {canEdit && lowSuppliers && lowSuppliers.length === 0 && activeSuppliers.length > 0 && (
        <p className="flex items-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-muted">
          <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-brand-600" />
          Nothing to draft from low stock: no product is below its minimum or running out, or every shortfall is already on an open order.
        </p>
      )}
      {canEdit && lowSuppliers && chosenLow && (
        <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 sm:p-4">
          <Sparkles aria-hidden className="mb-2.5 hidden h-5 w-5 text-amber-700 sm:block" />
          <div className="min-w-56 flex-1">
            <label className={labelClass} htmlFor="low-stock-supplier">
              Draft an order for what is running low
            </label>
            <SearchSelect
              id="low-stock-supplier"
              noun="suppliers"
              options={lowSuppliers.map((s) => ({
                value: String(s.supplier_id),
                label: `${s.name} · ${s.products.length} low`,
                group: s.has_product_list ? "Matches their product list" : "No product list set",
              }))}
              value={String(chosenLow.supplier_id)}
              onChange={setDraftSupplier}
            />
            <ul className="mt-2 space-y-1.5 text-sm text-amber-950">
              {suggestions
                .filter((s) => s.quantity > 0 && chosenLow.products.includes(s.product_name))
                .map((s) => (
                  <li key={s.product_id}>
                    {/* The reason folds away; tap the line to see why that amount. */}
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold">
                        {s.product_name}: {s.quantity} {s.base_unit}
                        <ChevronDown aria-hidden className="h-4 w-4 shrink-0 transition group-open:rotate-180" />
                      </summary>
                      <p className="mt-0.5 text-xs text-amber-900">{s.reason}</p>
                    </details>
                  </li>
                ))}
            </ul>
            <p className="mt-1.5 hidden text-xs text-amber-900 sm:block">Amounts cover a week of recent use (sales and counts) plus each minimum.</p>
          </div>
          <button className={secondaryButton} onClick={() => void draftFromLowStock()}>
            Draft from low stock
          </button>
        </section>
      )}

      <div role="tablist" aria-label="Filter by status" className="grid grid-cols-4 gap-1 rounded-xl bg-slate-200/60 p-1 sm:flex sm:w-fit">
        {(["", "draft", "issued", "cancelled"] as const).map((s) => (
          <button
            key={s || "all"}
            role="tab"
            aria-selected={filter === s}
            onClick={() => setFilter(s)}
            className={`rounded-lg px-1 py-1.5 text-[13px] font-semibold capitalize sm:px-3.5 sm:text-sm ${filter === s ? "bg-white text-brand-950 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      <ErrorNote message={error} />
      {orders?.length === 0 && (
        <Empty>{canEdit ? "No purchase orders yet. Create one, or draft one from low stock." : "No purchase orders yet."}</Empty>
      )}
      {orders && orders.length > 0 && (
        <ul className={`${panelClass} divide-y divide-line`}>
          {orders.map((o) => (
            <li key={o.id}>
              <button onClick={() => open(o)} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-surface">
                <span>
                  <span className="flex items-center gap-2 font-bold text-brand-950">
                    <PackageCheck aria-hidden className="h-4 w-4 text-brand-600" />
                    {o.reference} · {o.supplier}
                  </span>
                  <span className="block text-sm text-muted">
                    {o.lines.length} {o.lines.length === 1 ? "product" : "products"} · ordered {o.order_date}
                    {o.expected_date && ` · expected ${o.expected_date}`}
                  </span>
                </span>
                <OrderBadges order={o} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {canEdit && <Suppliers suppliers={suppliers} products={products} onChanged={load} />}
    </div>
  );
}
