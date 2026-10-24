import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { inputClass } from "./ui";

export type SelectOption = { value: string; label: string; group?: string };

/**
 * A dropdown with a search box: tap to see the whole list (grouped, e.g. by category), or type to
 * narrow it. Works with the keyboard (arrows, Enter, Escape). Label it with <label htmlFor={id}>.
 */
export default function SearchSelect({
  id,
  options,
  value,
  onChange,
  placeholder = "Choose…",
  noun = "options",
}: {
  id: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** What the list holds, for the search box: "products", "suppliers". */
  noun?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = `${id}-list`;
  const selected = options.find((o) => o.value === value);

  // Ungrouped options (like "Not in the catalogue") first, then each group together.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q ? options.filter((o) => `${o.label} ${o.group ?? ""}`.toLowerCase().includes(q)) : options;
    return [...hits].sort((a, b) => (a.group ?? "").localeCompare(b.group ?? ""));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    root.current?.lastElementChild?.scrollIntoView?.({ block: "nearest" });
    // On a phone the keyboard would cover the list; people tap the search box when they want it.
    if (!window.matchMedia?.("(pointer: coarse)").matches) search.current?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function show() {
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function choose(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
    document.getElementById(id)?.focus();
  }

  function keys(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.min(Math.max(i + step, 0), shown.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      document.getElementById(id)?.focus();
    }
  }

  useEffect(() => {
    document.getElementById(`${id}-opt-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, id]);

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            show();
          }
        }}
        className={`${inputClass} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`min-w-0 truncate ${selected ? "" : "text-slate-400"}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-full min-w-[15rem] overflow-hidden rounded-xl border border-line bg-white shadow-lg">
          <div className="relative border-b border-line p-2">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              ref={search}
              type="search"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={shown[active] ? `${id}-opt-${active}` : undefined}
              aria-label={`Search ${noun}`}
              placeholder={`Search ${noun}…`}
              autoComplete="off"
              className="w-full rounded-lg bg-slate-50 py-2 pl-8 pr-2 text-base text-ink outline-none focus:ring-2 focus:ring-brand-600/30"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={keys}
            />
          </div>
          <ul id={listId} role="listbox" aria-label={noun} className="max-h-64 overflow-y-auto py-1">
            {shown.map((o, i) => (
              <Fragment key={o.value}>
                {o.group && o.group !== shown[i - 1]?.group && (
                  <li role="presentation" className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    {o.group}
                  </li>
                )}
                <li
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-sm text-ink ${i === active ? "bg-brand-50" : ""}`}
                >
                  <span className="min-w-0">{o.label}</span>
                  {o.value === value && <Check aria-hidden className="h-4 w-4 shrink-0 text-brand-700" />}
                </li>
              </Fragment>
            ))}
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-muted">No {noun} match “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
