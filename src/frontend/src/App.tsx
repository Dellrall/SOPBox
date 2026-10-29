import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import {
  ArrowLeftRight,
  ClipboardCheck,
  ClipboardList,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageSearch,
  ShoppingCart,
  ScanLine,
  Settings as SettingsIcon,
  ShieldCheck,
  Truck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { api, setBranch, setSignedOutHandler } from "./api";
import { ClosedBanner } from "./Closing";
import { CodePrompt, MfaGate } from "./Mfa";
import Pricing from "./Pricing";
import Privacy from "./Privacy";
import Contact from "./Contact";
import { PolicyLinks } from "./Site";
import Activity from "./Activity";
import Approvals from "./Approvals";
import AuthPage from "./AuthPage";
import Landing from "./Landing";
import Dashboard from "./Dashboard";
import { InboxBell, InboxPanel, useInboxRefresh } from "./Inbox";
import { describeSignIn } from "./signin";
import Products from "./Products";
import PurchaseOrders from "./PurchaseOrders";
import Receive from "./Receive";
import Records from "./Records";
import Settings from "./Settings";
import Stocktake from "./Stocktake";
import StockMoves from "./StockMoves";
import Team from "./Team";
import { MascotDock, type Scene } from "./Mascot";
import { WorkspaceSwitch } from "./WorkspaceSwitch";
import { SdgFooter } from "./Sdg";
import type { Me, Notification, Role, SectionKey } from "./types";
import { ROLE_LABEL } from "./ui";

export type PageId =
  | "dashboard"
  | "receive"
  | "records"
  | "products"
  | "purchasing"
  | "approvals"
  | "activity"
  | "stocktake"
  | "stock"
  | "team"
  | "settings";

const NAV: { id: PageId; label: string; icon: LucideIcon; roles: Role[]; access?: SectionKey }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["owner", "manager", "staff"], access: "dashboard" },
  { id: "receive", label: "Receiving check", icon: ScanLine, roles: ["owner", "manager", "staff"], access: "receive" },
  { id: "records", label: "Delivery records", icon: Truck, roles: ["owner", "manager", "staff"], access: "records" },
  { id: "products", label: "Products & SOP", icon: PackageSearch, roles: ["owner", "manager", "staff"], access: "products" },
  { id: "purchasing", label: "Purchase orders", icon: ShoppingCart, roles: ["owner", "manager", "staff"], access: "purchasing" },
  { id: "approvals", label: "Approvals", icon: ClipboardCheck, roles: ["owner", "manager", "staff"], access: "approvals" },
  { id: "activity", label: "Activity log", icon: History, roles: ["owner", "manager", "staff"], access: "activity" },
  { id: "stocktake", label: "Stock Count", icon: ClipboardList, roles: ["owner", "manager", "staff"], access: "stocktake" },
  { id: "stock", label: "Stock & sales", icon: ArrowLeftRight, roles: ["owner", "manager", "staff"], access: "stocktake" },
  { id: "team", label: "Team", icon: Users, roles: ["owner"] },
  { id: "settings", label: "Settings", icon: SettingsIcon, roles: ["owner", "manager", "staff"] },
];

function sectionAllowed(me: Me, section: SectionKey, edit = false): boolean {
  if (me.role !== "staff") return true;
  const access = me.section_access[section] ?? "none";
  return edit ? access === "edit" : access === "view" || access === "edit";
}

function firstPage(me: Me): PageId {
  return (
    NAV.find((item) => item.roles.includes(me.role) && (!item.access || sectionAllowed(me, item.access)))?.id ??
    "settings"
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Signed-out visitors move between three addresses: the welcome page, sign in and sign up. */
export type PublicRoute = "/" | "/signin" | "/register" | "/pricing" | "/privacy" | "/contact";
/** A public page, optionally with a query, e.g. /contact?topic=sales. */
export type PublicPath = PublicRoute | `${PublicRoute}?${string}`;
const PUBLIC: PublicRoute[] = ["/signin", "/register", "/pricing", "/privacy", "/contact"];
const asPublic = (path: string): PublicRoute => PUBLIC.find((p) => p === path) ?? "/";

export default function App() {
  // undefined while we ask the server whether there is a session, null when signed out.
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [path, setPath] = useState<PublicRoute>(() => asPublic(window.location.pathname));
  // The query too, so /contact -> /contact?topic=sales opens the sales form without a reload.
  const [search, setSearch] = useState(window.location.search);
  // The HQ branch being worked in; null for the person's own workspace.
  const [branch, setBranchId] = useState<number | null>(null);

  useEffect(() => {
    const onPop = () => {
      setPath(asPublic(window.location.pathname));
      setSearch(window.location.search);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: PublicPath) => {
    if (to !== window.location.pathname + window.location.search) window.history.pushState(null, "", to);
    setPath(asPublic(to.split("?")[0]!));
    setSearch(window.location.search);
    window.scrollTo(0, 0);
  }, []);

  const signedIn = useCallback((who: Me) => {
    // The app itself lives at /, so a refresh after signing in lands back in it.
    window.history.replaceState(null, "", "/");
    setPath("/"); // so signing out later shows the welcome page, matching the address
    setMe(who);
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => setMe(null));
    api
      .session()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    const refreshSession = () => {
      api.session().then(setMe).catch(() => undefined);
    };
    window.addEventListener("focus", refreshSession);
    return () => window.removeEventListener("focus", refreshSession);
  }, []);

  if (me === undefined)
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        <span className="sr-only">Loading</span>
      </div>
    );
  if (path === "/pricing") return <Pricing navigate={navigate} signedIn={me !== null} />;
  if (path === "/privacy") return <Privacy navigate={navigate} signedIn={me !== null} />;
  if (path === "/contact") return <Contact key={search} navigate={navigate} signedIn={me !== null} />;
  if (me === null) {
    if (path === "/") return <Landing navigate={navigate} />;
    return <AuthPage mode={path === "/register" ? "register" : "signin"} navigate={navigate} onSignedIn={signedIn} />;
  }
  if (me.mfa_pending) return <MfaGate onDone={setMe} onSignOut={() => void api.logout().finally(() => setMe(null))} />;
  // In a branch, the pages see the branch and the role this person has there (see auth.in_branch).
  const choice = me.workspaces.find((w) => w.id === branch && w.id !== me.workspace.id);
  setBranch(choice?.id ?? null); // every API call from here on names the branch
  const working = choice ? { ...me, role: choice.role, workspace: { id: choice.id, name: choice.name } } : me;
  return (
    <>
      <CodePrompt />
      <Shell
        key={working.workspace.id}
        me={working}
        onMeChanged={setMe}
        onSwitch={setBranchId}
        onSignedOut={() => {
          setBranchId(null);
          setMe(null);
        }}
      />
    </>
  );
}

/**
 * "Your last sign-in was …" once per session, so a sign-in the person did not make stands out.
 * New devices and methods also land in their inbox.
 */
function LastSignIn({ me, onReview }: { me: Me; onReview: () => void }) {
  const last = me.previous_sign_in;
  const key = last ? `sopbox-seen-sign-in-${last.id}` : "";
  const [hidden, setHidden] = useState(() => {
    try {
      return !last || sessionStorage.getItem(key) === "1";
    } catch {
      return !last;
    }
  });
  if (hidden || !last) return null;
  const hide = () => {
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      /* shown again next time; harmless */
    }
    setHidden(true);
  };
  return (
    <div role="status" className="mb-5 flex items-start gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm shadow-sm print:hidden">
      <ShieldCheck aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
      <p className="flex-1 text-slate-700">
        Welcome back, {me.display_name.split(/\s+/)[0]}. Your last sign-in was <strong className="text-ink">{describeSignIn(last)}</strong>.{" "}
        Not you?{" "}
        <button
          type="button"
          className="font-semibold text-brand-700 underline"
          onClick={() => {
            hide();
            onReview();
          }}
        >
          Review sign-ins
        </button>
      </p>
      <button type="button" onClick={hide} aria-label="Dismiss" className="rounded-lg p-1 text-muted hover:bg-slate-100">
        <X aria-hidden className="h-4 w-4" />
      </button>
    </div>
  );
}

/** What the helpers do on a page that has nothing going on. */
const IDLE: Record<PageId, Scene> = {
  dashboard: { who: "cabbage", action: "wave" },
  receive: { who: "fish", action: "wave", text: "Snap the delivery order and I'll read the lines for you." },
  records: { who: "fish", action: "read" },
  products: { who: "cabbage", action: "count" },
  purchasing: { who: "carrot", action: "write" },
  approvals: { who: "carrot", action: "read" },
  activity: { who: "fish", action: "read" },
  stocktake: { who: "cabbage", action: "count" },
  stock: { who: "carrot", action: "count" },
  team: { who: "crew", action: "wave" },
  settings: { who: "cabbage", action: "sleep" },
};

function Shell({
  me,
  onMeChanged,
  onSwitch,
  onSignedOut,
}: {
  me: Me;
  onMeChanged: (me: Me) => void;
  onSwitch: (workspaceId: number) => void;
  onSignedOut: () => void;
}) {
  // Connecting Google or Telegram comes back to /settings.
  const [page, setPage] = useState<PageId>(() => (window.location.pathname === "/settings" ? "settings" : firstPage(me)));
  useEffect(() => {
    if (window.location.pathname !== "/") window.history.replaceState(null, "", "/");
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  // Swipe left on the open menu (or the dimmed page beside it) to close it; the menu follows the finger.
  const swipeStart = useRef<{ x: number; y: number; sideways: boolean | null } | null>(null);
  const [drag, setDrag] = useState(0);
  const swipe = {
    onTouchStart: (e: TouchEvent) => {
      swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, sideways: null };
    },
    onTouchMove: (e: TouchEvent) => {
      const start = swipeStart.current;
      if (!start) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      // Decide once, after a few pixels, whether this is a sideways swipe or a scroll of the menu.
      if (start.sideways === null && Math.abs(dx) + Math.abs(dy) > 8) start.sideways = Math.abs(dx) > Math.abs(dy);
      if (start.sideways) setDrag(Math.min(0, dx));
    },
    onTouchEnd: () => {
      if (drag < -70) setMenuOpen(false);
      swipeStart.current = null;
      setDrag(0);
    },
  };
  const [pending, setPending] = useState(0);
  // Set when a purchase order's "Receive a delivery" button opens the receiving check.
  const [receivePo, setReceivePo] = useState<number | null>(null);
  const canViewApprovals = sectionAllowed(me, "approvals");
  const canDecide = sectionAllowed(me, "approvals", true);

  const refreshPending = useCallback(() => {
    if (!canViewApprovals) {
      setPending(0);
      return;
    }
    api
      .deliveries("pending_approval", 100)
      .then((d) => setPending(d.length))
      .catch(() => undefined);
  }, [canViewApprovals]);

  useEffect(refreshPending, [refreshPending, page]);

  // Keep the tab title in step with the page, for history and screen readers.
  useEffect(() => {
    const label = NAV.find((n) => n.id === page)?.label ?? "SOPBox";
    document.title = `${label} · ${me.workspace.name} · SOPBox`;
  }, [page, me.workspace.name]);

  // Bumped on every menu click, so choosing the page you are on returns it to its start
  // (for example from one purchase order back to the list).
  const [visit, setVisit] = useState(0);
  const go = (id: PageId) => {
    setPage(id);
    setVisit((v) => v + 1);
    setMenuOpen(false);
  };

  useInboxRefresh(page);
  const canViewRecords = sectionAllowed(me, "records");
  // A notification is always about a delivery: open the list where it can be seen.
  const openNotification = (n: Notification) => {
    if (n.kind === "approval_needed" && canViewApprovals) go("approvals");
    else if (canViewRecords) go("records");
    else if (canViewApprovals) go("approvals");
  };

  async function signOut() {
    await api.logout().catch(() => undefined);
    onSignedOut();
  }

  const nav = useMemo(
    () => NAV.filter((n) => n.roles.includes(me.role) && (!n.access || sectionAllowed(me, n.access))),
    [me],
  );

  useEffect(() => {
    if (!nav.some((item) => item.id === page)) setPage(nav[0]?.id ?? "settings");
  }, [nav, page]);

  return (
    <div className="min-h-screen bg-surface text-ink lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white/85 px-4 py-3 backdrop-blur lg:hidden print:hidden">
        <button
          aria-label="Open the menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="rounded-xl border border-slate-300 p-2 text-slate-700 hover:bg-slate-50"
        >
          <Menu aria-hidden className="h-5 w-5" />
        </button>
        <img src="/logo-128.webp" alt="" className="h-8 w-8 rounded-lg object-cover" />
        <span className="font-bold text-brand-950">SOPBox</span>
        <div className="ml-auto flex items-center gap-2">
          {pending > 0 && (
            <button
              onClick={() => go("approvals")}
              className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-600/20"
            >
              {pending} waiting
            </button>
          )}
          <InboxBell />
        </div>
      </header>

      {menuOpen && <div className="fixed inset-0 z-30 bg-brand-950/50 backdrop-blur-sm lg:hidden" onClick={() => setMenuOpen(false)} {...swipe} />}

      <aside
        {...(menuOpen ? swipe : {})}
        style={drag ? { transform: `translateX(${drag}px)`, transition: "none" } : undefined}
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col print:hidden bg-brand-950 text-white shadow-2xl transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:translate-x-0 lg:shadow-none ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <img src="/logo-128.webp" alt="" className="h-10 w-10 rounded-xl object-cover ring-2 ring-white/10" />
          <div className="leading-tight">
            <span className="block text-lg font-bold">SOPBox</span>
            <span className="text-xs text-white/60">Receiving checks</span>
          </div>
          {/* On phones the bell is in the top bar instead. */}
          <div className="ml-auto hidden lg:block">
            <InboxBell tone="dark" />
          </div>
          <button aria-label="Close the menu" onClick={() => setMenuOpen(false)} className="ml-auto rounded-lg p-1.5 hover:bg-white/10 lg:hidden">
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>
        <div className="mx-4 flex items-center gap-2.5 rounded-xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10">
          <ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-leaf" />
          <div className="min-w-0 flex-1">
            {me.workspaces.length > 1 ? (
              <WorkspaceSwitch me={me} onSwitch={onSwitch} />
            ) : (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Workspace</p>
                <p className="truncate text-sm font-semibold">{me.workspace.name}</p>
              </>
            )}
          </div>
        </div>
        <nav aria-label="Main" className="mt-5 flex-1 space-y-1 overflow-y-auto px-3">
          {nav.map((n) => {
            const active = page === n.id;
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                aria-current={active ? "page" : undefined}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                  active ? "bg-white text-brand-950 shadow-sm" : "text-white/75 hover:bg-white/[0.08] hover:text-white"
                }`}
              >
                <Icon aria-hidden className={`h-[18px] w-[18px] ${active ? "text-brand-600" : "text-white/55 group-hover:text-white"}`} />
                <span className="flex-1">{n.label}</span>
                {n.id === "approvals" && pending > 0 && (
                  <span className="rounded-full bg-sand px-2 py-0.5 text-xs font-bold text-brand-950">{pending}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="m-3 flex items-center gap-3 rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-leaf text-sm font-bold text-brand-950">
            {initials(me.display_name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{me.display_name}</p>
            <p className="truncate text-xs text-white/60">
              {ROLE_LABEL[me.role]} · {me.username}
            </p>
          </div>
          <button onClick={() => void signOut()} aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white">
            <LogOut aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:py-10 lg:pb-28">
        <ClosedBanner me={me} onOpen={() => go("settings")} />
        <LastSignIn me={me} onReview={() => go("settings")} />
        <InboxPanel onOpen={openNotification} />
        {/* Receive stays mounted so a half-filled delivery survives a look at another page. */}
        <div hidden={page !== "receive"}>
          <Receive
            active={page === "receive"}
            canEdit={sectionAllowed(me, "receive", true)}
            purchaseOrderId={receivePo}
            onPurchaseOrderTaken={() => setReceivePo(null)}
          />
        </div>
        {page === "dashboard" && (
          <Dashboard
            key={visit}
            me={me}
            go={go}
            canStartReceive={sectionAllowed(me, "receive")}
            canEditProducts={sectionAllowed(me, "products", true)}
            canViewRecords={canViewRecords}
            canViewApprovals={canViewApprovals}
            onOpenNotification={openNotification}
            canViewPurchasing={sectionAllowed(me, "purchasing")}
          />
        )}
        {page === "records" && <Records key={visit} />}
        {page === "products" && <Products key={visit} canEdit={sectionAllowed(me, "products", true)} />}
        {page === "purchasing" && (
          <PurchaseOrders
            key={visit}
            canEdit={sectionAllowed(me, "purchasing", true)}
            canReceive={sectionAllowed(me, "receive", true)}
            onReceive={(id) => {
              setReceivePo(id);
              go("receive");
            }}
          />
        )}
        {page === "approvals" && <Approvals key={visit} canDecide={canDecide} onChanged={refreshPending} />}
        {page === "activity" && <Activity key={visit} />}
        {page === "stocktake" && <Stocktake key={visit} canEdit={sectionAllowed(me, "stocktake", true)} />}
        {page === "stock" && <StockMoves key={visit} canEdit={sectionAllowed(me, "stocktake", true)} />}
        {page === "team" && me.role === "owner" && <Team key={visit} />}
        {page === "settings" && <Settings key={visit} me={me} onMeChanged={onMeChanged} />}
        {/* Pushed to the bottom on short pages. */}
        <div className="mt-auto pt-12">
          <SdgFooter className="border-t border-line pt-5" />
          <PolicyLinks className="mt-3" />
        </div>
      </main>
      <MascotDock fallback={IDLE[page]} go={go} />
    </div>
  );
}
