import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AtSign, Bell, CheckCheck, ClipboardCheck, LogIn, MessageSquare, Truck, X, type LucideIcon } from "lucide-react";
import { api } from "./api";
import type { Inbox, Notification, NotificationKind } from "./types";

/**
 * The signed-in person's notifications: tagged on a delivery, a delivery waiting for approval, a
 * decision or a comment on one they are involved in. One store, so the bell and the dashboard
 * line always agree; the shell refreshes it every half minute and on every page change.
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
  sign_in: { icon: LogIn, label: "New sign-in" },
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

// Whether the inbox panel is open. One panel for the app (InboxPanel), opened by either bell
// (phone header, sidebar) or the dashboard's latest-notification line.
let panelOpen = false;
const panelListeners = new Set<() => void>();
function setPanelOpen(open: boolean) {
  panelOpen = open;
  panelListeners.forEach((l) => l());
}
export const openInbox = () => setPanelOpen(true);

function usePanelOpen() {
  return useSyncExternalStore(
    (l) => {
      panelListeners.add(l);
      return () => panelListeners.delete(l);
    },
    () => panelOpen,
  );
}

/** The bell with the unread count. */
export function InboxBell({ tone = "light" }: { tone?: "light" | "dark" }) {
  const { unread } = useInbox();
  return (
    <button
      type="button"
      onClick={openInbox}
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
  );
}

/** The inbox as a panel from the right. Render once, from the shell. */
export function InboxPanel({ onOpen }: { onOpen: (n: Notification) => void }) {
  const { unread, items } = useInbox();
  const open = usePanelOpen();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanelOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  // In the body: the phone header's blur would trap a fixed panel rendered inside it.
  return createPortal(
    <div className="fixed inset-0 z-50 print:hidden">
      <div className="absolute inset-0 bg-brand-950/40" onClick={() => setPanelOpen(false)} />
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
          <button ref={closeRef} type="button" onClick={() => setPanelOpen(false)} aria-label="Close the inbox" className="rounded-lg p-1.5 text-muted hover:bg-slate-100">
            <X aria-hidden className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">
          <InboxList
            items={items}
            onOpen={(n) => {
              setPanelOpen(false);
              onOpen(n);
            }}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** For the dashboard: just the newest unread notification, one line. Nothing when all is read. */
export function LatestNotification({ onOpen }: { onOpen: (n: Notification) => void }) {
  const { unread, items } = useInbox();
  const latest = items.find((n) => !n.read);
  if (!latest) return null;
  const { icon: Icon, label } = KIND[latest.kind];
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-2.5 shadow-sm">
      <button
        type="button"
        onClick={() => {
          void markRead([latest.id]);
          onOpen(latest);
        }}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <Icon aria-hidden className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted">
            <span className="font-semibold">{label}</span> · {ago(latest.created_at)}
          </span>
          <span className="block truncate text-sm font-medium text-ink">{latest.body}</span>
        </span>
      </button>
      <button type="button" onClick={openInbox} className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-brand-700 hover:bg-brand-50">
        {unread > 1 ? `+${unread - 1} more` : "Inbox"}
      </button>
    </div>
  );
}
