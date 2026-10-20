import { useEffect, useState } from "react";
import { api } from "./api";
import type { Product } from "./types";
import { ErrorNote, cardClass, inputClass, labelClass } from "./ui";

const rangeText = (p: Product): string =>
  p.effective_temp_min_c === null
    ? "No temperature check"
    : `Arrives at ${p.effective_temp_min_c} to ${p.effective_temp_max_c} °C`;

/** Products with their stock and SOP card. The search box is the SOP lookup. */
export default function Catalogue() {
  const [q, setQ] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      api
        .products(q.trim())
        .then((found) => {
          if (stale) return;
          setProducts(found);
          setError("");
        })
        .catch((e: Error) => !stale && setError(e.message));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q]);

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass} htmlFor="sop-search">
          Find a product or SOP
        </label>
        <input id="sop-search" type="search" className={inputClass} placeholder="For example: frozen, bundle, leaking" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorNote message={error} />
      {!error && products.length === 0 && <p className="text-sm text-slate-600">No products match.</p>}
      {products.map((p) => (
        <article key={p.id} className={`${cardClass} space-y-2`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">{p.name}</h3>
            <span className="text-sm text-slate-600">{p.category}</span>
          </div>
          <p className="text-sm">{rangeText(p)}</p>
          {p.pack_units.length > 0 && (
            <p className="text-sm text-slate-700">
              {p.pack_units.map((u) => `1 ${u.unit} = ${u.base_qty} ${p.base_unit}`).join(", ")}
            </p>
          )}
          <p className="text-sm">
            In stock: {p.stock} {p.base_unit}
            {p.min_stock > 0 && ` (minimum ${p.min_stock})`}
            {p.low_stock && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Low stock</span>}
          </p>
          {p.sop && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-teal-800">SOP</summary>
              <p className="mt-1 whitespace-pre-line text-slate-700">{p.sop}</p>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}
