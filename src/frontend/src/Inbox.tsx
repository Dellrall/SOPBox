import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AtSign, Bell, CheckCheck, ClipboardCheck, MessageSquare, Truck, X, type LucideIcon } from "lucide-react";
import { api } from "./api";
import type { Inbox, Notification, NotificationKind } from "./types";
import { secondaryButton } from "./ui";

/**
 * The signed-in person's notifications: tagged on a delivery, a delivery waiting for approval, a
 * decision or a comment on one they are involved in. One store, so the bell and the dashboard card
 * always agree; the shell refreshes it every half minute and on every page change.
 */

let inbox: Inbox = { unread: 0, items: [] };
const listeners = new Set<() => void>();
const publish = (next: Inbox) => {
  inbox = next;
  listeners.forEach((l) => l());
};

export async function refreshInbox() {
  try {
    publish(await api.inbox());
  } catch {
    // Keep what we had; the next refresh tries again.
  }
}

async function markRead(ids?: number[]) {
  // Show it read straight away, then let the server have the last word.
  publish({
    unread: ids ? inbox.items.filter((n) => !n.read && !ids.includes(n.id)).length : 0,
    items: inbox.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)),
  });
  await api.markRead(ids).catch(() => undefined);
  await refreshInbox();
}

export function useInbox(): Inbox {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => inbox,
  );
}

/** Keep the inbox fresh while the app is open. Call once, from the shell. */
export function useInboxRefresh(trigger: unknown) {
  useEffect(() => {
    void refreshInbox();
  }, [trigger]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshInbox();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
}

const KIND: Record<NotificationKind, { icon: LucideIcon; label: string }> = {
  tagged: { icon: AtSign, label: "Tagged" },
  approval_needed: { icon: ClipboardCheck, label: "Needs approval" },
  decided: { icon: Truck, label: "Decision" },
  comment: { icon: MessageSquare, label: "Comment" },
};

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/** Notifications, newest first. Opening one marks it read. */
export function InboxList({ items, onOpen }: { items: Notification[]; onOpen: (n: Notification) => void }) {
  if (items.length === 0) return <p className="px-4 py-6 text-center text-sm text-muted">Nothing here yet. You'll see it when someone tags you or a delivery needs you.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((n) => {
        const { icon: Icon, label } = KIND[n.kind];
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => {
                if (!n.read) void markRead([n.id]);
                onOpen(n);
              }}
              className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 ${n.read ? "" : "bg-brand-50/60"}`}
            >
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${n.read ? "bg-slate-100 text-muted" : "bg-brand-100 text-brand-700"}`}>
                <Icon aria-hidden className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-xs text-muted">
                  <span className="font-semibold">{label}</span> · {ago(n.created_at)}
                  {!n.read && <span className="ml-auto h-2 w-2 rounded-full bg-brand-600" aria-label="Unread" />}
                </span>
                <span className={`mt-0.5 block break-words text-sm ${n.read ? "text-slate-600" : "font-medium text-ink"}`}>{n.body}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The bell with the unread count; opens the inbox as a panel from the right. */
export function InboxBell({ onOpen, tone = "light" }: { onOpen: (n: Notification) => void; tone?: "light" | "dark" }) {
  const { unread, items } = useInbox();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}
        title="Inbox"
        className={`relative rounded-xl p-2 ${tone === "dark" ? "text-white/80 hover:bg-white/10 hover:text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-50"}`}
      >
        <Bell aria-hidden className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 print:hidden">
          <div className="absolute inset-0 bg-brand-950/40" onClick={() => setOpen(false)} />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Inbox"
            className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white text-ink shadow-2xl"
          >
            <header className="flex items-center gap-2 border-b border-line px-4 py-3">
              <h2 className="flex-1 text-lg font-bold text-brand-950">Inbox</h2>
              {unread > 0 && (
                <button type="button" onClick={() => void markRead()} className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-brand-700 hover:bg-brand-50">
                  <CheckCheck aria-hidden className="h-4 w-4" /> Mark all read
                </button>
              )}
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label="Close the inbox" className="rounded-lg p-1.5 text-muted hover:bg-slate-100">
                <X aria-hidden className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto">
              <InboxList
                items={items}
                onOpen={(n) => {
                  setOpen(false);
                  onOpen(n);
                }}
              />
            </div>
          </section>
        </div>
      )}
    </>
  );
}

/** The latest few notifications, for the dashboard. */
export function InboxCard({ onOpen }: { onOpen: (n: Notification) => void }) {
  const { unread, items } = useInbox();
  return (
    <section aria-labelledby="inbox-card-title" className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <Bell aria-hidden className="h-4 w-4 text-brand-600" />
        <h2 id="inbox-card-title" className="flex-1 font-bold text-brand-950">
          Inbox {unread > 0 && <span className="ml-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{unread} new</span>}
        </h2>
        {unread > 0 && (
          <button type="button" className={`${secondaryButton} px-2.5 py-1 text-xs`} onClick={() => void markRead()}>
            Mark all read
          </button>
        )}
      </div>
      <InboxList items={items.slice(0, 5)} onOpen={onOpen} />
    </section>
  );
}
