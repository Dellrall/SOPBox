import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { StorageAreas } from "./Places";
import type { Category } from "./types";
import { DeleteIconButton, EditIconButton, Empty, ErrorNote, PageTitle, TempInput, cardClass, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

const num = (text: string): number | null => (text.trim() === "" ? null : Number(text));
const range = (c: Category) =>
  c.temp_min_c === null ? "No temperature check" : `Arrives at ${c.temp_min_c} to ${c.temp_max_c} °C`;

function CategoryForm({
  category,
  onSaved,
  onCancel,
}: {
  category?: Category;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [min, setMin] = useState(category?.temp_min_c?.toString() ?? "");
  const [max, setMax] = useState(category?.temp_max_c?.toString() ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const low = num(min);
    const high = num(max);
    if ((low === null) !== (high === null)) return setError("Fill in both temperatures, or leave both empty.");
    if ((low !== null && Number.isNaN(low)) || (high !== null && Number.isNaN(high)))
      return setError("Temperatures must be numbers.");
    setBusy(true);
    setError("");
    const body = { name: name.trim(), temp_min_c: low, temp_max_c: high };
    try {
      if (category) await api.updateCategory(category.id, body);
      else await api.createCategory(body);
      if (!category) {
        setName("");
        setMin("");
        setMax("");
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const id = category ? `c${category.id}` : "new";
  return (
    <form
      className="grid grid-cols-2 gap-3 @2xl:grid-cols-[2fr_1fr_1fr_auto] @2xl:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="col-span-2 @2xl:col-span-1">
        <label className={labelClass} htmlFor={`cat-name-${id}`}>
          Category name
        </label>
        <input id={`cat-name-${id}`} required maxLength={80} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`cat-min-${id}`}>
          Lowest °C
        </label>
        <TempInput id={`cat-min-${id}`} value={min} onChange={setMin} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`cat-max-${id}`}>
          Highest °C
        </label>
        <TempInput id={`cat-max-${id}`} value={max} onChange={setMax} />
      </div>
      <div className="col-span-2 flex gap-2 @2xl:col-span-1">
        <button type="submit" disabled={busy} className={primaryButton}>
          {category ? "Save" : "Add"}
        </button>
        {onCancel && (
          <button type="button" className={secondaryButton} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <div className="col-span-2 @2xl:col-span-4">
        <ErrorNote message={error} />
      </div>
    </form>
  );
}

/** Categories carry the default arrival temperature for their products. */
export default function Categories({
  categories,
  canEdit,
  onChanged,
}: {
  categories: Category[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function remove(c: Category) {
    if (!window.confirm(`Delete the category "${c.name}"?`)) return;
    try {
      await api.deleteCategory(c.id);
      setError("");
      onChanged();
    } catch (e) {
      setError(
        (e as Error).message.includes("in use")
          ? `"${c.name}" still has products. Move or delete them first.`
          : (e as Error).message,
      );
    }
  }

  return (
    <section className={`${cardClass} @container space-y-3`} aria-labelledby="categories-heading">
      <h2 id="categories-heading" className="text-base font-bold text-brand-950">
        Categories
      </h2>
      <p className="text-sm text-slate-600">
        Products use their category&apos;s temperature unless they have their own.
      </p>
      <ErrorNote message={error} />
      {categories.length === 0 && (
        <Empty>{canEdit ? <>No categories yet. Add the first one below, for example &quot;Frozen&quot; at -20 to -10 °C.</> : "No categories yet."}</Empty>
      )}
      <ul className="divide-y divide-line">
        {categories.map((c) => (
          <li key={c.id} className="py-2">
            {editing === c.id ? (
              <CategoryForm
                category={c}
                onSaved={() => {
                  setEditing(null);
                  onChanged();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-slate-600">{range(c)}</p>
                </div>
                <div className={canEdit ? "flex gap-1" : "hidden"}>
                  <EditIconButton label={`Edit ${c.name}`} onClick={() => setEditing(c.id)} />
                  <DeleteIconButton label={`Delete ${c.name}`} onClick={() => void remove(c)} />
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canEdit && <CategoryForm onSaved={onChanged} />}
    </section>
  );
}

/** One page for how products are grouped (categories) and where stock sits (storage areas in each outlet). */
export function CategoriesAndStorage({ canEditCategories, canEditStorage }: { canEditCategories: boolean; canEditStorage: boolean }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api
      .categories()
      .then(setCategories)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-5">
      <PageTitle
        title="Categories & storage"
      />
      <ErrorNote message={error} />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Categories categories={categories} canEdit={canEditCategories} onChanged={load} />
        <StorageAreas canEdit={canEditStorage} />
      </div>
    </div>
  );
}
