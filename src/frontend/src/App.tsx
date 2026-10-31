import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from "react";
import {
  ArrowLeftRight,
  CalendarClock,
  BarChart3,
  BookOpen,
  Boxes,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  History,
  Layers,
  LayoutDashboard,
  ListChecks,
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
import { PolicyLinks } from "./Site";
import AuthPage from "./AuthPage";
import Landing from "./Landing";
import { InboxBell, InboxPanel, useInboxRefresh } from "./Inbox";
import { ProfileMenu } from "./ProfileMenu";
import { PrintHost } from "./Print";
import { describeSignIn, rememberSignIn } from "./signin";
import { MascotDock, type Scene } from "./Mascot";
import { WorkspaceSwitch } from "./WorkspaceSwitch";
import { OutletSwitch } from "./OutletSwitch";
import { SdgFooter } from "./Sdg";
import type { Me, Notification, Role, SectionKey } from "./types";
import { roleLabel } from "./ui";

// Each page's code loads when it is first opened, so the first screen downloads less. The sign-in
// and welcome pages are in the first download, since a visitor sees one of them first. Once signed
// in, the rest is fetched while the browser is idle (prefetchPages), so pages still open at once.
const LOADERS = {
  Pricing: () => import("./Pricing"),
  Privacy: () => import("./Privacy"),
  Docs: () => import("./Docs"),
  Contact: () => import("./Contact"),
  Activity: () => import("./Activity"),
  Approvals: () => import("./Approvals"),
  Dashboard: () => import("./Dashboard"),
  Products: () => import("./Products"),
  PurchaseOrders: () => import("./PurchaseOrders"),
  Receive: () => import("./Receive"),
  Records: () => import("./Records"),
  Settings: () => import("./Settings"),
  Stocktake: () => import("./Stocktake"),
  StockMoves: () => import("./StockMoves"),
  Team: () => import("./Team"),
  Help: () => import("./Help"),
  Categories: () => import("./Categories"),
  Tasks: () => import("./Tasks"),
  Expiry: () => import("./Expiry"),
  Reports: () => import("./Reports"),
};
const Pricing = lazy(LOADERS.Pricing);
const Privacy = lazy(LOADERS.Privacy);
const Docs = lazy(LOADERS.Docs);
const Contact = lazy(LOADERS.Contact);
const Activity = lazy(LOADERS.Activity);
const Tasks = lazy(LOADERS.Tasks);
const Approvals = lazy(LOADERS.Approvals);
const Dashboard = lazy(LOADERS.Dashboard);
const Products = lazy(LOADERS.Products);
const PurchaseOrders = lazy(LOADERS.PurchaseOrders);
const Receive = lazy(LOADERS.Receive);
const Records = lazy(LOADERS.Records);
const Settings = lazy(LOADERS.Settings);
const Stocktake = lazy(LOADERS.Stocktake);
const StockMoves = lazy(LOADERS.StockMoves);
const Team = lazy(LOADERS.Team);
const Expiry = lazy(LOADERS.Expiry);
const Reports = lazy(LOADERS.Reports);
const Help = lazy(LOADERS.Help);
const CategoriesAndStorage = lazy(() => LOADERS.Categories().then((m) => ({ default: m.CategoriesAndStorage })));

function prefetchPages() {
  const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1500));
  idle(() => Object.values(LOADERS).forEach((load) => void load().catch(() => undefined)));
}

/** Fades out index.html's loading screen once the first real page is drawn. It sits inside the
 * page's Suspense, so the screen stays up until that page's code has arrived. */
function Ready() {
  useEffect(() => {
    const boot = document.getElementById("boot");
    if (!boot) return;
    boot.classList.add("done");
    setTimeout(() => boot.remove(), 250);
  }, []);
  return null;
}

const Loaded = ({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) => (
  <Suspense fallback={fallback}>
    <Ready />
    {children}
  </Suspense>
);

export type PageId =
  | "dashboard"
  | "receive"
  | "records"
  | "products"
  | "categories"
  | "purchasing"
  | "approvals"
  | "tasks"
  | "activity"
  | "stocktake"
  | "stock"
  | "expiry"
  | "reports"
  | "team"
  | "help"
  | "settings";

const NAV: { id: PageId; label: string; icon: LucideIcon; roles: Role[]; access?: SectionKey }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["owner", "manager", "staff"], access: "dashboard" },
  { id: "receive", label: "Receiving check", icon: ScanLine, roles: ["owner", "manager", "staff"], access: "receive" },
  { id: "records", label: "Order records", icon: Truck, roles: ["owner", "manager", "staff"], access: "records" },
  { id: "products", label: "Products & SOP", icon: PackageSearch, roles: ["owner", "manager", "staff"], access: "products" },
  { id: "categories", label: "Categories & storage", icon: Layers, roles: ["owner", "manager", "staff"], access: "products" },
  { id: "purchasing", label: "Purchase orders", icon: ShoppingCart, roles: ["owner", "manager", "staff"], access: "purchasing" },
  { id: "approvals", label: "Approvals", icon: ClipboardCheck, roles: ["owner", "manager", "staff"], access: "approvals" },
  { id: "tasks", label: "Tasks", icon: ListChecks, roles: ["owner", "manager", "staff"] },
  { id: "activity", label: "Activity log", icon: History, roles: ["owner", "manager", "staff"], access: "activity" },
  { id: "stocktake", label: "Stock Count", icon: ClipboardList, roles: ["owner", "manager", "staff"], access: "stocktake" },
  { id: "stock", label: "Stock & sales", icon: ArrowLeftRight, roles: ["owner", "manager", "staff"], access: "stocktake" },
  { id: "expiry", label: "Expiry dates", icon: CalendarClock, roles: ["owner", "manager", "staff"], access: "stocktake" },
  { id: "reports", label: "Reports", icon: BarChart3, roles: ["owner", "manager"] },
  { id: "team", label: "Team", icon: Users, roles: ["owner", "manager"] },
  { id: "help", label: "Help & guides", icon: BookOpen, roles: ["owner", "manager", "staff"] },
  { id: "settings", label: "Settings", icon: SettingsIcon, roles: ["owner", "manager", "staff"] },
];

/** The menu: pages used often stand alone; the rest sit in groups that open and close. */
type Group = { label: string; icon: LucideIcon; items: PageId[] };
const MENU: (PageId | Group)[] = [
  "dashboard",
  "tasks",
  "reports",
  { label: "Catalogue", icon: PackageSearch, items: ["products", "categories"] },
  { label: "Stock", icon: Boxes, items: ["stocktake", "stock", "expiry"] },
  // Order, receive it, approve what failed, then the record.
  { label: "Ordering", icon: Truck, items: ["purchasing", "receive", "approvals", "records"] },
];
/** Pages about the person and the business, in the menu under their picture. */
const PROFILE: PageId[] = ["team", "activity", "help", "settings"];
const OPEN_GROUPS = "sopbox-menu-open";

/** The phone's bottom bar: the first four of these the person may open, then More for the full menu. */
// Left to right on the bar: Receive sits in the middle, under the thumb.
const TAB_ORDER: PageId[] = ["dashboard", "approvals", "records", "receive", "stocktake", "purchasing", "products"];
const TABS: { id: PageId; label: string }[] = [
  { id: "receive", label: "Receive" },
  { id: "approvals", label: "Approvals" },
  { id: "records", label: "Records" },
  { id: "dashboard", label: "Dashboard" },
  { id: "stocktake", label: "Stock" },
  { id: "purchasing", label: "Orders" },
  { id: "products", label: "Products" },
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

/** Signed-out visitors move between three addresses: the welcome page, sign in and sign up. */
export type PublicRoute = "/" | "/signin" | "/register" | "/pricing" | "/docs" | "/privacy" | "/contact";
/** A public page, optionally with a query, e.g. /contact?topic=sales. */
export type PublicPath = PublicRoute | `${PublicRoute}?${string}`;
const PUBLIC: PublicRoute[] = ["/signin", "/register", "/pricing", "/docs", "/privacy", "/contact"];
const asPublic = (path: string): PublicRoute => PUBLIC.find((p) => p === path) ?? "/";

/**
 * Signed-in pages live at /w/<workspace public id>/<page>, e.g. /w/3f9a1c7e2b4d/records. The id is
 * random, so it does not hint at how many workspaces there are, and it is not a secret: the server
 * checks every request against the session, so another workspace's id opens nothing.
 */
export const appAddress = (path: string): { ws: string; page: string } | null => {
  const m = /^\/w\/([a-z0-9]{1,40})(?:\/([a-z]+))?\/?$/.exec(path);
  return m ? { ws: m[1]!, page: m[2] ?? "" } : null;
};

export default function App() {
  // undefined while we ask the server whether there is a session, null when signed out.
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [path, setPath] = useState<PublicRoute>(() => asPublic(window.location.pathname));
  // The query too, so /contact -> /contact?topic=sales opens the sales form without a reload.
  const [search, setSearch] = useState(window.location.search);
  // The HQ branch being worked in; null for the person's own workspace. A link can name one.
  const [branch, setBranchId] = useState<string | null>(() => appAddress(window.location.pathname)?.ws ?? null);
  // The workspace the opening address named, to say so when it is not one of this person's.
  const [linked, setLinked] = useState(() => appAddress(window.location.pathname)?.ws ?? null);

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
    // A link into the app (/w/...) opens once signed in; otherwise the app takes over from /.
    if (!appAddress(window.location.pathname)) window.history.replaceState(null, "", "/");
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

  // Remember how this browser signed in, for the "Last used" tag on the sign-in page.
  useEffect(() => rememberSignIn(me?.sign_in_method), [me?.sign_in_method]);

  useEffect(() => {
    if (me) prefetchPages();
  }, [me]);

  useEffect(() => {
    const refreshSession = () => {
      api.session().then(setMe).catch(() => undefined);
    };
    window.addEventListener("focus", refreshSession);
    return () => window.removeEventListener("focus", refreshSession);
  }, []);

  // The loading screen from index.html stays up until then.
  if (me === undefined) return null;
  if (path === "/pricing") return <Loaded><Pricing navigate={navigate} signedIn={me !== null} /></Loaded>;
  if (path === "/docs") return <Loaded><Docs navigate={navigate} signedIn={me !== null} /></Loaded>;
  if (path === "/privacy") return <Loaded><Privacy navigate={navigate} signedIn={me !== null} /></Loaded>;
  if (path === "/contact") return <Loaded><Contact key={search} navigate={navigate} signedIn={me !== null} /></Loaded>;
  if (me === null) {
    if (path === "/" && !appAddress(window.location.pathname)) return <Loaded><Landing navigate={navigate} /></Loaded>;
    return <Loaded><AuthPage mode={path === "/register" ? "register" : "signin"} navigate={navigate} onSignedIn={signedIn} /></Loaded>;
  }
  if (me.mfa_pending) return <Loaded><MfaGate onDone={setMe} onSignOut={() => void api.logout().finally(() => setMe(null))} /></Loaded>;
  // In a branch, the pages see the branch and the role this person has there (see auth.in_branch).
  const choice = me.workspaces.find((w) => w.public_id === branch && w.id !== me.workspace.id);
  setBranch(choice?.id ?? null); // every API call from here on names the branch
  const working = choice ? { ...me, role: choice.role, workspace: { id: choice.id, public_id: choice.public_id, name: choice.name } } : me;
  const lost = linked !== null && linked !== me.workspace.public_id && !me.workspaces.some((w) => w.public_id === linked);
  return (
    <>
      <CodePrompt />
      <Shell
        key={working.workspace.id}
        me={working}
        onMeChanged={setMe}
        lost={lost}
        onSwitch={(id) => {
          setLinked(null);
          setBranchId(id);
        }}
        onSignedOut={() => {
          setBranchId(null);
          setLinked(null);
          window.history.replaceState(null, "", "/");
          setPath("/");
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
    <div role="status" className="mb-3 flex items-start gap-2 rounded-2xl border border-line bg-white px-3 py-2 text-xs shadow-sm sm:mb-5 sm:gap-3 sm:px-4 sm:py-3 sm:text-sm print:hidden">
      <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 sm:h-5 sm:w-5" />
      <p className="flex-1 text-slate-700">
        <span className="hidden sm:inline">Welcome back, {me.display_name.split(/\s+/)[0]}. Your last</span>
        <span className="sm:hidden">Last</span> sign-in: <strong className="text-ink">{describeSignIn(last)}</strong>.{" "}
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
  categories: { who: "cabbage", action: "count" },
  purchasing: { who: "carrot", action: "write" },
  approvals: { who: "carrot", action: "read" },
  activity: { who: "fish", action: "read" },
  tasks: { who: "carrot", action: "write" },
  stocktake: { who: "cabbage", action: "count" },
  stock: { who: "carrot", action: "count" },
  expiry: { who: "fish", action: "read" },
  reports: { who: "carrot", action: "read" },
  team: { who: "crew", action: "wave" },
  help: { who: "cabbage", action: "read", text: "Pick a page to read about, or tap Show me and I'll walk you through it." },
  settings: { who: "cabbage", action: "sleep" },
};

function Shell({
  me,
  lost,
  onMeChanged,
  onSwitch,
  onSignedOut,
}: {
  me: Me;
  /** The opening address named a workspace this person is not in. */
  lost: boolean;
  onMeChanged: (me: Me) => void;
  onSwitch: (publicId: string) => void;
  onSignedOut: () => void;
}) {
  // The page from the address: /w/<id>/<page>, or /settings where connecting Google or Telegram comes back to.
  const [page, setPage] = useState<PageId>(() => {
    const at = appAddress(window.location.pathname);
    // A link to a workspace this person is not in still opens the same page, in their own.
    const wanted = at && (at.ws === me.workspace.public_id || lost) ? at.page : window.location.pathname === "/settings" ? "settings" : "";
    return NAV.find((n) => n.id === wanted)?.id ?? firstPage(me);
  });
  const [lostShown, setLostShown] = useState(lost);
  const reachable = (ws: string) => ws === me.workspace.public_id || me.workspaces.some((w) => w.public_id === ws);

  // Keep the address on this workspace and page. Moving to another page, or into another workspace,
  // adds a history entry; the first address on opening replaces a bare, old or unusable one.
  const opened = useRef(false);
  useEffect(() => {
    const want = `/w/${me.workspace.public_id}/${page}`;
    const { pathname, search, hash } = window.location;
    if (pathname !== want) {
      const from = appAddress(pathname);
      if (opened.current || (from && from.ws !== me.workspace.public_id && reachable(from.ws))) window.history.pushState(null, "", want);
      else window.history.replaceState(null, "", want + search + hash); // keeps the Settings tab and sign-in link results
    }
    opened.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, me.workspace.id]);

  // Back and forward: another page here, or another workspace (the app re-opens in it).
  useEffect(() => {
    const onPop = () => {
      const at = appAddress(window.location.pathname);
      if (!at) return;
      if (at.ws !== me.workspace.public_id) {
        if (reachable(at.ws)) onSwitch(at.ws);
        return;
      }
      const id = NAV.find((n) => n.id === at.page)?.id;
      if (id) setPage(id);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.workspace.id]);
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
  const [outletTurn, setOutletTurn] = useState(0); // Receive stays mounted: it reloads when this changes
  const go = (id: PageId) => {
    setPage(id);
    setVisit((v) => v + 1);
    setMenuOpen(false);
  };

  useInboxRefresh(page);
  const canViewRecords = sectionAllowed(me, "records");
  // A notification is always about a delivery: open the list where it can be seen.
  const openNotification = (n: Notification) => {
    if (n.kind === "expiry" && sectionAllowed(me, "stocktake")) go("expiry");
    else if (n.kind === "approval_needed" && canViewApprovals) go("approvals");
    else if (canViewRecords) go("records");
    else if (canViewApprovals) go("approvals");
  };

  async function signOut() {
    await api.logout().catch(() => undefined);
    onSignedOut();
  }

  const nav = useMemo(
    () =>
      NAV.filter(
        (n) =>
          n.roles.includes(me.role) &&
          (!n.access || sectionAllowed(me, n.access)) &&
          // Managers look after the team of the outlet they work at.
          (n.id !== "team" || me.role === "owner" || me.outlet_id != null),
      ),
    [me],
  );
  const canOpen = (id: PageId) => nav.some((item) => item.id === id);
  // Records only fills in for staff who cannot see approvals.
  const tabs = TABS.filter((t) => canOpen(t.id) && (t.id !== "records" || !canOpen("approvals")))
    .slice(0, 4)
    .sort((a, b) => TAB_ORDER.indexOf(a.id) - TAB_ORDER.indexOf(b.id));

  useEffect(() => {
    if (!nav.some((item) => item.id === page)) setPage(nav[0]?.id ?? "settings");
  }, [nav, page]);

  // Which groups are open, remembered on this device; the group of the page you are on always opens.
  const [openGroups, setOpenGroups] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(OPEN_GROUPS) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const toggleGroup = (label: string, open: boolean) =>
    setOpenGroups((all) => {
      const next = open ? [...all, label] : all.filter((g) => g !== label);
      try {
        localStorage.setItem(OPEN_GROUPS, JSON.stringify(next));
      } catch {
        // private window: the menu just forgets
      }
      return next;
    });
  useEffect(() => {
    const group = MENU.find((m): m is Group => typeof m !== "string" && m.items.includes(page));
    if (group && !openGroups.includes(group.label)) toggleGroup(group.label, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const menuButton = (n: (typeof NAV)[number], sub = false) => {
    const active = page === n.id;
    const Icon = n.icon;
    return (
      <button
        key={n.id}
        onClick={() => go(n.id)}
        aria-current={active ? "page" : undefined}
        className={`group flex w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition ${sub ? "py-2" : "py-2.5"} ${
          active ? "bg-orbyte-50 text-orbyte shadow-sm" : "text-white/75 hover:bg-white/[0.08] hover:text-white"
        }`}
      >
        {!sub && <Icon aria-hidden className={`h-[18px] w-[18px] ${active ? "text-orbyte" : "text-white/55 group-hover:text-white"}`} />}
        <span className="flex-1">{n.label}</span>
        {n.id === "approvals" && pending > 0 && (
          <span className="rounded-full bg-sand px-2 py-0.5 text-xs font-bold text-brand-950">{pending}</span>
        )}
      </button>
    );
  };

  const profileMenu = (where: "sidebar" | "top") => (
    <ProfileMenu
      name={me.display_name}
      detail={`${roleLabel(me)} · ${me.username}`}
      items={PROFILE.flatMap((id) => nav.filter((n) => n.id === id))}
      page={page}
      go={go}
      signOut={() => void signOut()}
      where={where}
    />
  );
  // Receiving is the main job: one tap from beside the bell.
  const receiveShortcut = (className: string) =>
    canOpen("receive") && (
      <button type="button" onClick={() => go("receive")} aria-label="Start a receiving check" title="Receiving check" className={className}>
        <ScanLine aria-hidden className="h-5 w-5" />
      </button>
    );

  return (
    <div className="min-h-screen bg-surface text-ink lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white/85 px-4 py-2 backdrop-blur lg:hidden print:hidden">
        <img src="/logo-128.webp" alt="" className="h-8 w-8 rounded-lg object-cover" />
        <span className="hidden font-bold text-brand-950 min-[400px]:inline">SOPBox</span>
        <div className="ml-auto flex items-center gap-1.5">
          {receiveShortcut("rounded-xl p-2 text-brand-700 ring-1 ring-line hover:bg-brand-50")}
          <InboxBell />
          {profileMenu("top")}
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
          <div className="ml-auto hidden items-center gap-1.5 lg:flex">
            {receiveShortcut("rounded-xl p-2 text-white/80 ring-1 ring-white/15 hover:bg-white/10 hover:text-white")}
            <InboxBell tone="dark" />
          </div>
          <button aria-label="Close the menu" onClick={() => setMenuOpen(false)} className="ml-auto rounded-lg p-1.5 hover:bg-white/10 lg:hidden">
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>
        <div className="mx-4 flex items-start gap-2.5 rounded-xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10">
          <ShieldCheck aria-hidden className="mt-3 h-4 w-4 shrink-0 text-leaf" />
          <div className="min-w-0 flex-1">
            {me.workspaces.length > 1 ? (
              <WorkspaceSwitch me={me} onSwitch={onSwitch} />
            ) : (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Workspace</p>
                <p className="truncate text-sm font-semibold">{me.workspace.name}</p>
              </>
            )}
            <OutletSwitch
              me={me}
              onChange={() => {
                setVisit((v) => v + 1);
                setOutletTurn((v) => v + 1);
              }}
              onManage={
                me.role === "staff"
                  ? undefined
                  : () => {
                      window.history.replaceState(null, "", `${window.location.pathname}#workspace`);
                      go("settings");
                    }
              }
            />
          </div>
        </div>
        <nav aria-label="Main" className="mt-5 flex-1 space-y-1 overflow-y-auto px-3">
          {MENU.map((m) => {
            if (typeof m === "string") {
              const n = nav.find((item) => item.id === m);
              return n ? menuButton(n) : null;
            }
            const items = m.items.map((id) => nav.find((item) => item.id === id)).filter((n) => n !== undefined);
            if (items.length === 0) return null;
            if (items.length === 1) return menuButton(items[0]!);
            const open = openGroups.includes(m.label);
            const here = items.some((n) => n.id === page);
            const Icon = m.icon;
            const listId = `menu-${m.label.toLowerCase()}`;
            return (
              <div key={m.label}>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  onClick={() => toggleGroup(m.label, !open)}
                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-white/[0.08] hover:text-white ${
                    here && !open ? "text-white" : "text-white/75"
                  }`}
                >
                  <Icon aria-hidden className={`h-[18px] w-[18px] ${here ? "text-leaf" : "text-white/55 group-hover:text-white"}`} />
                  <span className="flex-1">{m.label}</span>
                  <ChevronDown aria-hidden className={`h-4 w-4 text-white/50 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div id={listId} className="mb-1 ml-[1.35rem] mt-0.5 space-y-0.5 border-l border-white/15 pl-3">
                    {items.map((n) => menuButton(n, true))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="hidden lg:block">{profileMenu("sidebar")}</div>
      </aside>

      <main id="main" className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col px-4 pb-44 pt-4 sm:px-6 sm:pt-6 lg:px-10 lg:py-10 lg:pb-28">
        {lostShown && (
          <p role="status" className="mb-4 flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
            <span className="flex-1">
              That link is for a workspace you are not in, so you are in <strong>{me.workspace.name}</strong>.
            </span>
            <button type="button" aria-label="Dismiss" onClick={() => setLostShown(false)} className="rounded p-0.5 hover:bg-amber-100">
              <X aria-hidden className="h-4 w-4" />
            </button>
          </p>
        )}
        <ClosedBanner me={me} onOpen={() => go("settings")} />
        <LastSignIn me={me} onReview={() => go("settings")} />
        <InboxPanel onOpen={openNotification} />
        <PrintHost business={me.workspace.name} by={me.display_name} />
        <Loaded fallback={<p className="text-sm text-muted">Loading…</p>}>
        {/* Receive stays mounted so a half-filled delivery survives a look at another page. */}
        <div hidden={page !== "receive"}>
          <Receive
            active={page === "receive"}
            canEdit={sectionAllowed(me, "receive", true)}
            purchaseOrderId={receivePo}
            onPurchaseOrderTaken={() => setReceivePo(null)}
            reload={outletTurn}
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
        {page === "categories" && (
          <CategoriesAndStorage key={visit} canEditCategories={sectionAllowed(me, "products", true)} canEditStorage={me.role !== "staff"} />
        )}
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
        {page === "tasks" && <Tasks key={visit} canEdit={me.role !== "staff"} meId={me.id} go={go} />}
        {page === "stocktake" && <Stocktake key={visit} canEdit={sectionAllowed(me, "stocktake", true)} />}
        {page === "stock" && <StockMoves key={visit} canEdit={sectionAllowed(me, "stocktake", true)} />}
        {page === "expiry" && <Expiry key={visit} canEdit={sectionAllowed(me, "stocktake", true)} />}
        {page === "reports" && <Reports key={visit} />}
        {page === "team" && <Team key={visit} me={me} />}
        {page === "help" && <Help key={visit} me={me} go={go} canOpen={canOpen} />}
        {page === "settings" && <Settings key={visit} me={me} onMeChanged={onMeChanged} />}
        </Loaded>
        {/* Pushed to the bottom on short pages. */}
        <div className="mt-auto pt-12">
          {/* Phones skip it: on every page it would be one more screen to scroll past. */}
          <div className="hidden sm:block">
            <SdgFooter className="border-t border-line pt-5" />
          </div>
          <PolicyLinks className="mt-3" privacyOnly={me.role !== "owner"} />
        </div>
      </main>
      <MascotDock fallback={IDLE[page]} go={go} page={page} />

      <nav
        aria-label="Quick"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden"
      >
        {tabs.map((t) => {
          const Icon = NAV.find((n) => n.id === t.id)!.icon;
          const active = page === t.id;
          if (t.id === "receive")
            // The main job: a raised round button in the middle of the bar.
            return (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                aria-current={active ? "page" : undefined}
                className="flex h-16 flex-1 flex-col items-center justify-end gap-0.5 pb-1.5 text-[11px] font-semibold text-brand-700"
              >
                <span className={`-mt-6 flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-white ${active ? "bg-brand-700" : "bg-brand-600"}`}>
                  <Icon aria-hidden className="h-6 w-6" />
                </span>
                {t.label}
              </button>
            );
          return (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${active ? "text-brand-700" : "text-slate-500"}`}
            >
              <Icon aria-hidden className={`h-5 w-5 ${active ? "text-brand-600" : ""}`} />
              {t.label}
              {t.id === "approvals" && pending > 0 && (
                <span className="absolute left-1/2 top-1.5 ml-1.5 rounded-full bg-sand px-1.5 text-[10px] font-bold leading-4 text-brand-950">{pending}</span>
              )}
            </button>
          );
        })}
        <button
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          className={`flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
            tabs.some((t) => t.id === page) ? "text-slate-500" : "text-brand-700"
          }`}
        >
          <Menu aria-hidden className="h-5 w-5" />
          More
        </button>
      </nav>
    </div>
  );
}
