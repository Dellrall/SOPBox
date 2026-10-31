import { useEffect, useRef, useState, type KeyboardEvent as KeyEvent } from "react";
import { ChevronUp, LogOut, type LucideIcon } from "lucide-react";
import type { PageId } from "./App";

export type ProfileItem = { id: PageId; label: string; icon: LucideIcon };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * The person's own menu, opened from their picture: Team, Activity log, Help & guides, Settings and
 * Sign out. In the sidebar it opens upwards; in the phone's top bar it opens downwards.
 */
export function ProfileMenu({
  name,
  detail,
  items,
  page,
  go,
  signOut,
  where,
}: {
  name: string;
  detail: string;
  items: ProfileItem[];
  page: PageId;
  go: (page: PageId) => void;
  signOut: () => void;
  where: "sidebar" | "top";
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const top = where === "top";

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => box.current?.contains(e.target as Node) || setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    box.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const arrows = (e: KeyEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...(box.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(at + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
  };

  const item = top
    ? "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
    : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-white/85 hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none";

  return (
    <div ref={box} className={top ? "relative" : "relative m-3"}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu: ${name}`}
        onClick={() => setOpen(!open)}
        className={
          top
            ? "flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100"
            : "flex w-full items-center gap-3 rounded-xl bg-white/[0.06] p-3 text-left ring-1 ring-white/10 hover:bg-white/[0.1]"
        }
      >
        <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-full bg-leaf font-bold text-brand-950 ${top ? "h-8 w-8 text-xs" : "h-9 w-9 text-sm"}`}>
          {initials(name)}
        </span>
        {top ? (
          <span className="max-w-[5.5rem] truncate text-sm font-semibold text-brand-950">{name.split(/\s+/)[0]}</span>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{name}</span>
              <span className="block truncate text-xs text-white/60">{detail}</span>
            </span>
            <ChevronUp aria-hidden className={`h-4 w-4 text-white/60 transition-transform ${open ? "" : "rotate-180"}`} />
          </>
        )}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          onKeyDown={arrows}
          className={
            top
              ? "absolute right-0 top-full z-50 mt-2 w-60 rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-line"
              : "absolute inset-x-0 bottom-full z-50 mb-2 rounded-xl bg-brand-900 p-1.5 shadow-xl shadow-black/30 ring-1 ring-white/15"
          }
        >
          {top && (
            <p className="border-b border-line px-3 pb-2 pt-1.5 text-xs text-muted">
              <span className="block truncate text-sm font-semibold text-ink">{name}</span>
              {detail}
            </p>
          )}
          {items.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                type="button"
                role="menuitem"
                aria-current={page === n.id ? "page" : undefined}
                onClick={() => {
                  setOpen(false);
                  go(n.id);
                }}
                className={`${item} ${page === n.id ? (top ? "bg-brand-50 text-brand-800" : "bg-white/10 text-white") : ""}`}
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0 opacity-70" />
                {n.label}
              </button>
            );
          })}
          <button type="button" role="menuitem" onClick={signOut} className={`${item} mt-1 border-t ${top ? "border-line" : "border-white/10"}`}>
            <LogOut aria-hidden className="h-4 w-4 shrink-0 opacity-70" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
