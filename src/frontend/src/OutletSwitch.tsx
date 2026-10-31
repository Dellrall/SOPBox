import { useEffect, useRef, useState, type KeyboardEvent as KeyEvent } from "react";
import { Check, ChevronsUpDown, Settings2 } from "lucide-react";
import { api } from "./api";
import { setCurrentOutlet } from "./StorageSelect";
import type { Me, Outlet } from "./types";

/** The outlet this person last picked in this workspace, per account, so a shared tablet starts each person at their own. */
const remembered = (me: Me) => `sopbox-outlet-${me.id}-${me.workspace.id}`;

/**
 * The outlet under the workspace name: pages start on its storage areas. It starts at the outlet the
 * person works at (Team), or the one they picked last on this device. Shown once there is more than one;
 * someone tied to an outlet (Team) gets only theirs from the server, and sees its name.
 */
export function OutletSwitch({ me, onChange, onManage }: { me: Me; onChange: () => void; onManage?: () => void }) {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .outlets()
      .then((list) => {
        let saved: number | null = null;
        try {
          saved = Number(localStorage.getItem(remembered(me))) || null;
        } catch {
          // private window: start at their own outlet
        }
        const has = (id: number | null | undefined) => list.some((o) => o.id === id);
        const start = has(saved) ? saved : has(me.outlet_id) ? me.outlet_id! : (list[0]?.id ?? null);
        setOutlets(list);
        setCurrent(start);
        setCurrentOutlet(start);
      })
      .catch(() => setOutlets([]));
  }, [me]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => box.current?.contains(e.target as Node) || setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    box.current?.querySelector<HTMLButtonElement>("#outlet-list [aria-current=true]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const arrows = (e: KeyEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("#outlet-list button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  const pick = (id: number) => {
    setOpen(false);
    if (id === current) return;
    setCurrent(id);
    setCurrentOutlet(id);
    try {
      localStorage.setItem(remembered(me), String(id));
    } catch {
      // private window: the choice lasts until the page is closed
    }
    onChange();
  };

  const name = outlets.find((o) => o.id === current)?.name ?? "";
  // Someone tied to an outlet sees only theirs: name it, with nothing to switch to.
  if (outlets.length === 1 && me.outlet_id != null)
    return (
      <p className="mt-2 border-t border-white/10 pt-2">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-white/50">Your outlet</span>
        <span className="block truncate text-sm text-white/85">{name}</span>
      </p>
    );
  if (outlets.length < 2) return null;
  return (
    <div ref={box} className="relative mt-2 border-t border-white/10 pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="outlet-list"
        aria-label={`Outlet: ${name}. Switch outlet`}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-white/50">Outlet</span>
          <span className="block truncate text-sm text-white/85">{name}</span>
        </span>
        <ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 text-white/60" />
      </button>
      {open && (
        <div
          id="outlet-list"
          onKeyDown={arrows}
          className="absolute -left-10 -right-3 top-full z-50 mt-3 max-h-80 overflow-y-auto rounded-xl bg-brand-900 p-1.5 shadow-xl shadow-black/30 ring-1 ring-white/15"
        >
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">Switch outlet</p>
          <ul aria-label="Outlets">
            {outlets.map((o) => {
              const here = o.id === current;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    aria-current={here}
                    onClick={() => pick(o.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf ${
                      here ? "bg-white/10 font-semibold text-white" : "text-white/80 hover:bg-white/[0.07] hover:text-white"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    {o.id === me.outlet_id && (
                      <span className="rounded-full bg-leaf/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-leaf">Yours</span>
                    )}
                    {here && <Check aria-hidden className="h-4 w-4 shrink-0 text-leaf" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {onManage && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onManage();
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-white/10 px-3 py-2.5 text-left text-sm text-sand hover:bg-white/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf"
            >
              <Settings2 aria-hidden className="h-4 w-4" />
              Manage outlets
            </button>
          )}
        </div>
      )}
    </div>
  );
}
