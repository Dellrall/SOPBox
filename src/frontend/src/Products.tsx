import { useCallback, useEffect, useRef, useState } from "react";
import { ScanText } from "lucide-react";
import { ApiError, api } from "./api";
import Categories from "./Categories";
import ImportSheet from "./ImportSheet";
import ProductForm from "./ProductForm";
import type { Category, Product } from "./types";
import { Empty, ErrorNote, PageTitle, SuccessNote, cardClass, dangerButton, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

const rangeText = (p: Product): string =>
  p.effective_temp_min_c === null
    ? "No temperature check"
    : `Arrives at ${p.effective_temp_min_c} to ${p.effective_temp_max_c} °C`;

/** Products with stock and SOP cards. The search box is the SOP lookup; managers can edit. */
export default function Products({ canEdit }: { canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const formTop = useRef<HTMLDivElement>(null);

  // The form opens near the top of the page; bring it into view from wherever Edit was pressed.
  useEffect(() => {
    if (!editing) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    formTop.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }, [editing]);

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      Promise.all([api.products(q.trim()), api.categories()])
        .then(([p, c]) => {
          if (stale) return;
          setProducts(p);
          setCategories(c);
          setError("");
        })
        .catch((e: Error) => !stale && setError(e.message));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, version]);

  async function remove(p: Product) {
    if (!window.confirm(`Delete ${p.name}?`)) return;
    try {
      await api.deleteProduct(p.id);
      reload();
    } catch (e) {
      // Products on past deliveries keep their history: offer to archive instead.
      if (e instanceof ApiError && e.status === 409) {
        if (window.confirm(`${p.name} is on past deliveries, so it cannot be deleted. Archive it instead? It will no longer be offered when receiving.`)) {
          await setArchived(p, true);
        }
        return;
      }
      setError((e as Error).message);
    }
  }

  async function setArchived(p: Product, archived: boolean) {
    try {
      await api.setArchived(p.id, archived);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = products?.filter((p) => !p.archived) ?? null;
  const archived = products?.filter((p) => p.archived) ?? [];

  return (
    <div className="space-y-4">
      <PageTitle title="Products & SOP" subtitle="What you buy, the rules each delivery is checked against, and how to handle it.">
        {canEdit && (
          <div className="flex flex-wrap gap-2 [&>button]:whitespace-nowrap">
            <button className={secondaryButton} onClick={() => setShowCategories((s) => !s)} aria-expanded={showCategories}>
              Categories
            </button>
            <button className={secondaryButton} onClick={() => setImporting((s) => !s)} aria-expanded={importing}>
              <ScanText aria-hidden className="h-4 w-4" /> Import from a sheet
            </button>
            <button className={primaryButton} onClick={() => setEditing("new")}>
              Add product
            </button>
          </div>
        )}
      </PageTitle>

      {notice && <SuccessNote>{notice}</SuccessNote>}
      {canEdit && importing && (
        <ImportSheet
          categories={categories}
          onCategoryAdded={async () => {
            const fresh = await api.categories();
            setCategories(fresh);
            return fresh;
          }}
          onDone={(count) => {
            setImporting(false);
            setNotice(`${count} ${count === 1 ? "product" : "products"} added from the sheet. Set each one's low-stock level and SOP with Edit.`);
            reload();
          }}
          onClose={() => setImporting(false)}
        />
      )}

      {canEdit && showCategories && (
        <Categories
          categories={categories}
          onChanged={reload}
        />
      )}

      <div ref={formTop} className="scroll-mt-20" />
      {editing && (
        <ProductForm
          key={editing === "new" ? "new" : editing.id}
          product={editing === "new" ? undefined : editing}
          categories={categories}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <div>
        <label className={labelClass} htmlFor="sop-search">
          Find a product or SOP
        </label>
        <input id="sop-search" type="search" className={inputClass} placeholder="For example: frozen, bundle, leaking" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorNote message={error} />
      {active?.length === 0 && !error && (
        <Empty>{q ? "No products match." : canEdit ? "No products yet. Add your first one." : "No products have been added yet."}</Empty>
      )}
      {active?.map((p) => (
        <article key={p.id} className={`${cardClass} space-y-2`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">
              {p.name}
              {p.code && <span className="ml-2 font-mono text-xs font-normal text-muted">{p.code}</span>}
            </h2>
            <span className="text-sm text-slate-600">{p.category}</span>
          </div>
          <p className="text-sm">{rangeText(p)}</p>
          {p.pack_units.length > 0 && (
            <p className="text-sm text-slate-700">{p.pack_units.map((u) => `1 ${u.unit} = ${u.base_qty} ${p.base_unit}`).join(", ")}</p>
          )}
          <p className="text-sm">
            In stock: {p.stock} {p.base_unit}
            {p.min_stock > 0 && ` (minimum ${p.min_stock})`}
            {p.low_stock && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Low stock</span>}
          </p>
          {p.sop && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-brand-800">SOP</summary>
              <p className="mt-1 whitespace-pre-line text-slate-700">{p.sop}</p>
            </details>
          )}
          {canEdit && (
            <div className="flex gap-2 pt-1">
              <button className={secondaryButton} onClick={() => setEditing(p)}>
                Edit
              </button>
              <button className={secondaryButton} onClick={() => void setArchived(p, true)}>
                Archive
              </button>
              <button className={dangerButton} onClick={() => void remove(p)}>
                Delete
              </button>
            </div>
          )}
        </article>
      ))}
      {archived.length > 0 && (
        <details className={cardClass}>
          <summary className="cursor-pointer font-semibold text-brand-950">Archived products ({archived.length})</summary>
          <p className="mt-2 text-sm text-muted">Not offered when receiving. Their past deliveries are kept.</p>
          <ul className="mt-3 divide-y divide-line">
            {archived.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span>
                  <span className="font-semibold">{p.name}</span>
                  <span className="block text-sm text-muted">{p.category}</span>
                </span>
                {canEdit && (
                  <button className={secondaryButton} onClick={() => void setArchived(p, false)}>
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
