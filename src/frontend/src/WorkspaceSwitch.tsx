import { useEffect, useRef, useState, type KeyboardEvent as KeyEvent } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { Me } from "./types";

/**
 * The sidebar's workspace switch, drawn in the sidebar's own colours: a native select's list
 * is painted by the phone or browser (often blue), which clashes with the deep green.
 */
export function WorkspaceSwitch({ me, onSwitch }: { me: Me; onSwitch: (publicId: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => box.current?.contains(e.target as Node) || setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    // Start keyboard users on the workspace they are in.
    box.current?.querySelector<HTMLButtonElement>("[aria-current=true]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  // Up and down move between workspaces in the open list.
  const arrows = (e: KeyEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("#workspace-list button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="workspace-list"
        aria-label={`Workspace: ${me.workspace.name}. Switch workspace`}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-white/50">Workspace</span>
          <span className="block truncate text-sm font-semibold text-white">{me.workspace.name}</span>
        </span>
        <ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 text-white/60" />
      </button>
      {open && (
        <ul
          id="workspace-list"
          aria-label="Workspaces"
          onKeyDown={arrows}
          className="absolute -left-10 -right-3 top-full z-50 mt-3 max-h-72 overflow-y-auto rounded-xl bg-brand-900 p-1.5 shadow-xl shadow-black/30 ring-1 ring-white/15"
        >
          {me.workspaces.map((w, i) => {
            const current = w.id === me.workspace.id;
            return (
              <li key={w.id}>
                <button
                  type="button"
                  aria-current={current}
                  onClick={() => {
                    setOpen(false);
                    if (!current) onSwitch(w.public_id);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf ${
                    current ? "bg-white/10 font-semibold text-white" : "text-white/80 hover:bg-white/[0.07] hover:text-white"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {i === 0 && (
                    <span className="rounded-full bg-leaf/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-leaf">HQ</span>
                  )}
                  {current && <Check aria-hidden className="h-4 w-4 shrink-0 text-leaf" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
