import { useEffect, useState } from "react";

type Product = {
  id: string;
  name: string;
  category: string;
  base_unit: string;
  temp_min_c: number | null;
  temp_max_c: number | null;
};

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/products")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Product[]>;
      })
      .then(setProducts)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main>
      <h1>Receiving check</h1>
      {error && <p role="alert">Could not load products: {error}</p>}
      <ul>
        {products.map((p) => (
          <li key={p.id}>
            {p.name} ({p.category}, base unit {p.base_unit})
          </li>
        ))}
      </ul>
    </main>
  );
}
