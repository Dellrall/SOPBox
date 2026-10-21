import type { Product } from "./types";
import { cardClass } from "./ui";

type Props = {
  /** Omit to create a new product. */
  product?: Product;
  onSaved: (saved: Product) => void;
  onCancel: () => void;
};

/**
 * Starter task: create and edit a product (name, category, base unit, pack sizes, minimum stock,
 * temperature override, SOP text). It needs the manager PIN, like the other catalogue writes.
 * Wire it into Catalogue.tsx, and add the matching calls to api.ts (POST and PUT /api/products).
 */
export default function ProductForm({ product, onSaved, onCancel }: Props) {
  void onSaved;
  return (
    <div className={cardClass}>
      <p>TODO: form for {product ? product.name : "a new product"}.</p>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
