import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type Choice = { value: string; label: string; group?: string };

/**
 * A dropdown drawn in the site's own style. A native select's list is painted by the system
 * (blue on Linux, and Firefox cannot restyle it), so this replaces it: a button that opens a list,
 * with the keys people expect from a select (the ARIA "select-only combobox" pattern). A <label
 * htmlFor={id}> names it as it would a select. The list opens above the page, so a scrolling table
 * cannot cut it off, and it opens upwards when there is no room below.
 */
export function Select({
  id,
  value,
  choices,
  onChange,
  className = "",
  disabled = false,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number }>();
  const typed = useRef({ text: "", at: 0 });
  const current = choices.find((c) => c.value === value);

  const show = (at = Math.max(0, choices.indexOf(current!))) => {
    if (disabled || choices.length === 0) return;
    setActive(at);
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  const choose = (i: number) => {
    const choice = choices[i];
    close();
    if (choice && choice.value !== value) onChange(choice.value);
  };

  // Under the button, or above it when the screen has more room there.
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const box = button.current.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - 8;
    const above = box.top - 8;
    const width = Math.min(Math.max(box.width, 180), window.innerWidth - 16);
    const left = Math.min(box.left, window.innerWidth - width - 8);
    setPlace(
      below >= 240 || below >= above
        ? { left, width, top: box.bottom + 4, maxHeight: Math.min(288, below) }
        : { left, width, bottom: window.innerHeight - box.top + 4, maxHeight: Math.min(288, above) },
    );
    list.current?.focus();
  }, [open]);

  // Clicking elsewhere, scrolling the page or resizing closes it, as a native select does.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !button.current?.contains(t)) close(false);
    };
    const scrolled = (e: Event) => list.current?.contains(e.target as Node) || close(false);
    const resized = () => close(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", resized);
    };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // Typing letters jumps to the first choice that starts with them.
  const jump = (key: string, from: number) => {
    const now = Date.now();
    typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + key.toLowerCase(), at: now };
    const order = [...choices.keys()].map((k) => (from + k) % choices.length);
    return order.find((i) => choices[i]!.label.toLowerCase().startsWith(typed.current.text));
  };

  const onButtonKey = (e: KeyboardEvent) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      show();
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const i = jump(e.key, Math.max(0, choices.indexOf(current!)) + 1);
      if (i !== undefined && choices[i]!.value !== value) onChange(choices[i]!.value);
    }
  };

  const onListKey = (e: KeyboardEvent) => {
    const last = choices.length - 1;
    const moves: Record<string, number> = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last };
    if (e.key in moves) setActive(moves[e.key]!);
    else if (e.key === "Enter" || e.key === " ") choose(active);
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") return close(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const i = jump(e.key, active + 1);
      if (i !== undefined) setActive(i);
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onButtonKey}
        className={`${className} flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? ""}</span>
        <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : id}
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onListKey}
            style={{ position: "fixed", ...place, visibility: place ? "visible" : "hidden" }}
            className="z-[60] overflow-y-auto rounded-xl bg-white p-1 text-sm text-ink shadow-xl shadow-brand-950/15 ring-1 ring-line focus:outline-none"
          >
            {choices.map((c, i) => (
              <div key={`${c.group ?? ""}:${c.value}`}>
                {c.group !== undefined && c.group !== choices[i - 1]?.group && (
                  <p aria-hidden className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {c.group}
                  </p>
                )}
                <div
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={c.value === value}
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(i)}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 ${i === active ? "bg-brand-50" : ""} ${
                    c.value === value ? "font-semibold text-brand-800" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1">{c.label}</span>
                  {c.value === value && <Check aria-hidden className="h-4 w-4 shrink-0 text-brand-600" />}
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
