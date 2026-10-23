import { useEffect, useState } from "react";
import { api } from "./api";
import type { PageId } from "./App";
import type { Delivery, Me, Product } from "./types";
import { Empty, ErrorNote, PageTitle, StatusBadge, cardClass, primaryButton, secondaryButton, when } from "./ui";

export default function Dashboard({ me, go }: { me: Me; go: (page: PageId) => void }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.products(), api.deliveries(undefined, 200)])
      .then(([p, d]) => {
        setProducts(p);
        setDeliveries(d);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!products) return <p className="text-slate-600">Loading…</p>;

  const count = (s: Delivery["status"]) => deliveries.filter((d) => d.status === s).length;
  const low = products.filter((p) => p.low_stock);
  const canEdit = me.role !== "staff";

  if (products.length === 0) {
    return (
      <div className="space-y-4">
        <PageTitle title={`Welcome, ${me.display_name}`} />
        <section className={`${cardClass} space-y-3`}>
          <h2 className="text-lg font-semibold">Set up your products</h2>
          {canEdit ? (
            <>
              <p className="text-sm text-slate-700">
                Receiving checks run against your own rules, so start by adding what you buy: categories
                (with the temperature they should arrive at), then products with their pack sizes and SOP.
              </p>
              <button className={primaryButton} onClick={() => go("products")}>
                Add products
              </button>
            </>
          ) : (
            <p className="text-sm text-slate-700">No products have been added yet. Ask a manager to add them.</p>
          )}
          {me.role === "owner" && (
            <p className="text-sm text-slate-700">
              Then create accounts for your team under{" "}
              <button className="underline" onClick={() => go("team")}>
                Team
              </button>
              .
            </p>
          )}
        </section>
      </div>
    );
  }

  const stat = (label: string, value: number, tone = "text-brand-900") => (
    <div className={cardClass}>
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`text-3xl font-semibold ${tone}`}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageTitle title="Dashboard">
        <button className={primaryButton} onClick={() => go("receive")}>
          Start a receiving check
        </button>
      </PageTitle>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stat("Waiting for a manager", count("pending_approval"), "text-amber-800")}
        {stat("Accepted", count("accepted"))}
        {stat("Rejected or returned", count("rejected") + count("returned"), "text-red-800")}
        {stat("Low-stock products", low.length, low.length ? "text-amber-800" : "text-brand-900")}
      </div>

      {canEdit && count("pending_approval") > 0 && (
        <button className={secondaryButton} onClick={() => go("approvals")}>
          Review {count("pending_approval")} waiting
        </button>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-brand-900">Low stock</h2>
        {low.length === 0 ? (
          <Empty>Nothing is below its minimum.</Empty>
        ) : (
          <ul className={`${cardClass} divide-y divide-line text-sm`}>
            {low.map((p) => (
              <li key={p.id} className="flex justify-between py-1.5">
                <span>{p.name}</span>
                <span className="text-amber-900">
                  {p.stock} of {p.min_stock} {p.base_unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-brand-900">Recent deliveries</h2>
        {deliveries.length === 0 ? (
          <Empty>No deliveries yet. Start a receiving check when the next one arrives.</Empty>
        ) : (
          <ul className={`${cardClass} divide-y divide-line text-sm`}>
            {deliveries.slice(0, 5).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  #{d.id} {d.supplier || "Unknown supplier"} · {when(d.created_at)}
                </span>
                <StatusBadge status={d.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
