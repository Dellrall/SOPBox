import { useEffect, useState } from "react";
import { inputClass } from "./ui";

type Option = { id: number; name: string; category: string };

const nameOf = (options: Option[], id: string) => options.find((o) => String(o.id) === id)?.name ?? "";

/**
 * A product field you can type into: the browser lists the products whose name matches.
 * `value` is the chosen product id, or "" while the text matches no product exactly.
 */
export default function ProductPicker({
  id,
  options,
  value,
  onChange,
}: {
  id: string;
  options: Option[];
  value: string;
  onChange: (productId: string) => void;
}) {
  const [text, setText] = useState(() => nameOf(options, value));

  // Follow a product chosen from outside (an order loaded for editing, a line reset).
  useEffect(() => {
    if (value) setText(nameOf(options, value));
  }, [value, options]);

  const typed = text.trim().toLowerCase();
  const unknown = typed !== "" && !value;

  return (
    <>
      <input
        id={id}
        list={`${id}-list`}
        autoComplete="off"
        placeholder="Type to search products…"
        aria-invalid={unknown || undefined}
        className={`${inputClass} ${unknown ? "border-amber-500!" : ""}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const match = options.find((o) => o.name.toLowerCase() === e.target.value.trim().toLowerCase());
          onChange(match ? String(match.id) : "");
        }}
      />
      <datalist id={`${id}-list`}>
        {options.map((o) => (
          <option key={o.id} value={o.name} label={o.category} />
        ))}
      </datalist>
      {unknown && <p className="mt-1 text-xs text-amber-800">Pick a product from the list.</p>}
    </>
  );
}
