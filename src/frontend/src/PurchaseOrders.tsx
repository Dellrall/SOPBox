import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, FilePlus2, PackageCheck, Plus, Printer, Send, Sparkles, Trash2, Truck, XCircle } from "lucide-react";
import { api } from "./api";
import type { Product, PurchaseOrder, PurchaseOrderIn, PurchaseOrderStatus, ReceivingStatus, Supplier } from "./types";
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

function Suppliers({ suppliers, onChanged }: { suppliers: Supplier[]; onChanged: () => void }) {
  const blank = { name: "", contact: "", phone: "", email: "" };
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editing) await api.updateSupplier(editing, form);
      else await api.createSupplier(form);
      setForm(blank);
      setEditing(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
      {suppliers.length > 0 && (
        <ul className="divide-y divide-line">
          {suppliers.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span>
                <span className={`font-semibold ${s.archived ? "text-muted line-through" : ""}`}>{s.name}</span>
                <span className="block text-sm text-muted">
                  {[s.contact, s.phone, s.email].filter(Boolean).join(" · ") || "No contact details"}
                </span>
              </span>
              <span className="flex gap-2">
                <button
                  className={secondaryButton}
                  onClick={() => {
                    setEditing(s.id);
                    setForm({ name: s.name, contact: s.contact, phone: s.phone, email: s.email });
                  }}
                >
                  Edit
                </button>
                <button className={secondaryButton} onClick={() => void archive(s)}>
                  {s.archived ? "Restore" : "Archive"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
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
            <label className={labelClass} htmlFor={`supplier-${key}`}>
              {label}
            </label>
            <input
              id={`supplier-${key}`}
              type={type}
              required={required}
              maxLength={key === "email" ? 254 : 120}
              className={inputClass}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </div>
        ))}
        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" className={primaryButton}>
            {editing ? "Save supplier" : "Add supplier"}
          </button>
          {editing && (
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                setEditing(null);
                setForm(blank);
              }}
            >
              Cancel
            </button>
          )}
        </div>
        <div className="sm:col-span-2">
          <ErrorNote message={error} />
        </div>
      </form>
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
          <select id="po-supplier" className={inputClass} value={chosenSupplier} onChange={(e) => setSupplierId(e.target.value)}>
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
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
            <div key={l.key} className="grid grid-cols-[1fr_6rem_7rem_auto] items-end gap-2">
              <div>
                <label className="sr-only" htmlFor={`po-product-${l.key}`}>
                  Product, line {i + 1}
                </label>
                <select
                  id={`po-product-${l.key}`}
                  className={inputClass}
                  value={l.productId}
                  onChange={(e) => setLine(l.key, { productId: e.target.value, unit: unitsOf(e.target.value).slice(-1)[0] ?? "" })}
                >
                  <option value="">Choose a product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
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
                <select id={`po-unit-${l.key}`} className={inputClass} value={l.unit} disabled={!units.length} onChange={(e) => setLine(l.key, { unit: e.target.value })}>
                  {units.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
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
  }, [filter]);
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
      const made = await api.lowStockDraft(Number(draftSupplier || suppliers.find((s) => !s.archived)?.id), today());
      setNotice(`${made.reference} drafted from low stock. Check it, then issue it.`);
      open(made);
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
            <Suppliers suppliers={suppliers} onChanged={load} />
          </div>
        )}
      </div>
    );
  }

  const activeSuppliers = suppliers.filter((s) => !s.archived);
  return (
    <div className="space-y-5">
      <PageTitle title="Purchase orders" subtitle="What you ordered from each supplier, and how much of it has arrived. Quantities only.">
        {canEdit && (
          <button className={primaryButton} onClick={() => setView({ kind: "new" })}>
            <FilePlus2 aria-hidden className="h-4 w-4" /> New purchase order
          </button>
        )}
      </PageTitle>

      {canEdit && activeSuppliers.length > 0 && (
        <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <Sparkles aria-hidden className="mb-2.5 h-5 w-5 text-amber-700" />
          <div className="min-w-56 flex-1">
            <label className={labelClass} htmlFor="low-stock-supplier">
              Draft an order for everything below its minimum
            </label>
            <select id="low-stock-supplier" className={inputClass} value={draftSupplier} onChange={(e) => setDraftSupplier(e.target.value)}>
              {activeSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button className={secondaryButton} onClick={() => void draftFromLowStock()}>
            Draft from low stock
          </button>
        </section>
      )}

      <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-1 rounded-xl bg-slate-200/60 p-1 sm:w-fit">
        {(["", "draft", "issued", "cancelled"] as const).map((s) => (
          <button
            key={s || "all"}
            role="tab"
            aria-selected={filter === s}
            onClick={() => setFilter(s)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold capitalize ${filter === s ? "bg-white text-brand-950 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
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

      {canEdit && <Suppliers suppliers={suppliers} onChanged={load} />}
    </div>
  );
}
