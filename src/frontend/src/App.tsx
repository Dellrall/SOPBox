import { useCallback, useEffect, useState } from "react";
import { api, setSignedOutHandler } from "./api";
import Activity from "./Activity";
import Approvals from "./Approvals";
import AuthPage from "./AuthPage";
import Dashboard from "./Dashboard";
import Products from "./Products";
import Receive from "./Receive";
import Records from "./Records";
import Settings from "./Settings";
import Team from "./Team";
import type { Me, Role } from "./types";
import { ROLE_LABEL } from "./ui";

export type PageId =
  | "dashboard"
  | "receive"
  | "records"
  | "products"
  | "approvals"
  | "activity"
  | "team"
  | "settings";

const NAV: { id: PageId; label: string; icon: string; roles: Role[] }[] = [
  { id: "dashboard", label: "Dashboard", icon: "▦", roles: ["owner", "manager", "staff"] },
  { id: "receive", label: "Receiving check", icon: "▣", roles: ["owner", "manager", "staff"] },
  { id: "records", label: "Delivery records", icon: "▤", roles: ["owner", "manager", "staff"] },
  { id: "products", label: "Products & SOP", icon: "▧", roles: ["owner", "manager", "staff"] },
  { id: "approvals", label: "Approvals", icon: "✓", roles: ["owner", "manager"] },
  { id: "activity", label: "Activity log", icon: "◷", roles: ["owner", "manager"] },
  { id: "team", label: "Team", icon: "♙", roles: ["owner"] },
  { id: "settings", label: "Settings", icon: "⚙", roles: ["owner", "manager", "staff"] },
];

export default function App() {
  // undefined while we ask the server whether there is a session, null when signed out.
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    setSignedOutHandler(() => setMe(null));
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return <p className="p-6 text-slate-600">Loading…</p>;
  if (me === null) return <AuthPage onSignedIn={setMe} />;
  return <Shell me={me} onSignedOut={() => setMe(null)} />;
}

function Shell({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [page, setPage] = useState<PageId>("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const canDecide = me.role !== "staff";

  const refreshPending = useCallback(() => {
    if (!canDecide) return;
    api
      .deliveries("pending_approval", 100)
      .then((d) => setPending(d.length))
      .catch(() => undefined);
  }, [canDecide]);

  useEffect(refreshPending, [refreshPending, page]);

  const go = (id: PageId) => {
    setPage(id);
    setMenuOpen(false);
  };

  async function signOut() {
    await api.logout().catch(() => undefined);
    onSignedOut();
  }

  const nav = NAV.filter((n) => n.roles.includes(me.role));

  return (
    <div className="min-h-screen bg-surface text-slate-900 lg:flex">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white px-4 py-3 lg:hidden">
        <button
          aria-label="Open the menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5"
        >
          ☰
        </button>
        <span className="font-semibold text-brand-900">SOPBox</span>
        {pending > 0 && <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-0.5 text-sm text-amber-900">{pending} waiting</span>}
      </header>

      {menuOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMenuOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-brand-900 text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-4">
          <img src="/SOPBox_Logo.jpeg" alt="" className="h-10 w-10 rounded-lg object-cover" />
          <span className="text-lg font-semibold">SOPBox</span>
          <button aria-label="Close the menu" onClick={() => setMenuOpen(false)} className="ml-auto text-xl lg:hidden">
            ✕
          </button>
        </div>
        <div className="mx-3 rounded-lg bg-white/10 px-3 py-2">
          <p className="text-xs text-white/70">Workspace</p>
          <p className="truncate font-medium">{me.workspace.name}</p>
        </div>
        <nav aria-label="Main" className="mt-4 flex-1 space-y-1 overflow-y-auto px-3">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => go(n.id)}
              aria-current={page === n.id ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${
                page === n.id ? "bg-white text-brand-900" : "text-white/90 hover:bg-white/10"
              }`}
            >
              <span aria-hidden className="w-5 text-center">
                {n.icon}
              </span>
              <span className="flex-1">{n.label}</span>
              {n.id === "approvals" && pending > 0 && (
                <span className="rounded-full bg-sand px-2 text-xs font-semibold text-brand-900">{pending}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/15 p-3">
          <p className="truncate text-sm font-medium">{me.display_name}</p>
          <p className="mb-2 text-xs text-white/70">
            {ROLE_LABEL[me.role]} · {me.username}
          </p>
          <button onClick={() => void signOut()} className="w-full rounded-lg border border-white/30 px-3 py-2 text-sm hover:bg-white/10">
            Sign out
          </button>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-5xl flex-1 p-4 lg:p-8">
        {/* Receive stays mounted so a half-filled delivery survives a look at another page. */}
        <div hidden={page !== "receive"}>
          <Receive active={page === "receive"} />
        </div>
        {page === "dashboard" && <Dashboard me={me} go={go} />}
        {page === "records" && <Records />}
        {page === "products" && <Products canEdit={canDecide} />}
        {page === "approvals" && canDecide && <Approvals onChanged={refreshPending} />}
        {page === "activity" && canDecide && <Activity />}
        {page === "team" && me.role === "owner" && <Team />}
        {page === "settings" && <Settings me={me} />}
      </main>
    </div>
  );
}
