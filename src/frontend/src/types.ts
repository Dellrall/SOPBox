// Mirrors src/backend/app/models.py. Keep the two in step when the API changes.

export type Role = "owner" | "manager" | "staff";
export type AccessLevel = "none" | "view" | "edit";
export type SectionKey =
  | "dashboard"
  | "receive"
  | "records"
  | "products"
  | "purchasing"
  | "approvals"
  | "activity"
  | "stocktake";
export type SectionAccess = Record<SectionKey, AccessLevel>;

export const SECTION_ACCESS_AREAS: { key: SectionKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "receive", label: "Receiving check" },
  { key: "records", label: "Delivery records" },
  { key: "products", label: "Products & SOP" },
  { key: "purchasing", label: "Purchase orders" },
  { key: "approvals", label: "Approvals" },
  { key: "activity", label: "Activity log" },
  { key: "stocktake", label: "Stock Count" },
];

export const DEFAULT_STAFF_ACCESS: SectionAccess = {
  dashboard: "view",
  receive: "edit",
  records: "view",
  products: "view",
  purchasing: "none",
  approvals: "none",
  activity: "none",
  stocktake: "view",
};

export type SignIn = { id: number; at: string; method: string; device: string };

export type Me = {
  id: number;
  username: string;
  email: string | null;
  display_name: string;
  role: Role;
  section_access: SectionAccess;
  // public_id is the random id in addresses and Settings; id is the internal one the API uses.
  workspace: { id: number; public_id: string; name: string };
  /** The sign-in before this session's, so a person notices one they did not make. */
  previous_sign_in: SignIn | null;
  sign_in_method?: string | null; // how this session was started
  /** Their own workspace first, then the branches linked to it when it is an HQ, with their role there. */
  workspaces: { id: number; public_id: string; name: string; role: Role }[];
  /** Two-step sign-in is on. */
  mfa_enabled: boolean;
  /** Signed in, but the authenticator code is still to be entered. */
  mfa_pending: boolean;
  /** The workspace requires two-step sign-in and it is not on yet. */
  mfa_setup_needed: boolean;
  /** May download data: the owner, and whoever the owner allows. */
  can_export: boolean;
  /** The outlet they work at: the app starts them there. Null: not tied to one. */
  outlet_id?: number | null;
  /** An assistant manager: adds and looks after staff, but disables nobody. */
  assistant?: boolean;
  /** Set while their workspace is closed: read-only, deleted for good on delete_on. */
  closing: Closing;
};

export type Closing = { closed_at: string | null; delete_on: string | null };

export type MfaPolicy = "off" | "managers" | "everyone";

/** Which first steps of setting up the workspace are done. */
export type Setup = { outlet: boolean; storage: boolean; product: boolean; team: boolean; delivery: boolean };

export type Plan = {
  plan: "free" | "pro" | "enterprise";
  label: string;
  pre_alpha: boolean;
  billing: "annual" | "lifetime" | null;
  until: string | null;
  lapsed: boolean;
  outlets_allowed: number | null;
  outlets_used: number;
  api_access: boolean;
  hq_links: boolean;
  customization: boolean;
  priority_support: boolean;
  active_outlets: number; // outlets with work recorded this month
  bill_sen: number | null; // Pro by use, this month so far
};

export type Pricing = {
  currency: string;
  prices: Record<string, number | null>;
  kofi_url: string;
  sales_email: string;
  sales_phone: string;
};

export type UserOut = {
  id: number;
  username: string;
  email: string | null;
  display_name: string;
  role: Role;
  section_access: SectionAccess;
  active: boolean;
  created_at: string;
  telegram_linked: boolean;
  /** Kept out of the Telegram team group until then; year 9999 means until let back in. */
  team_group_removed_until: string | null;
  security_alerts: boolean;
  mfa_enabled: boolean;
  can_export: boolean;
  outlet_id: number | null;
  assistant: boolean;
};

export type UserCreateIn = {
  username: string;
  display_name: string;
  email?: string;
  role: "manager" | "staff";
  password: string;
  section_access?: SectionAccess;
  outlet_id?: number | null;
  assistant?: boolean;
};

export type UserUpdateIn = {
  display_name?: string;
  email?: string;
  role?: "manager" | "staff";
  active?: boolean;
  password?: string;
  section_access?: SectionAccess;
  security_alerts?: boolean;
  mfa_reset?: boolean;
  can_export?: boolean;
  outlet_id?: number | null;
  assistant?: boolean;
};

export type RegisterIn = {
  workspace_name: string;
  display_name: string;
  email: string;
  username: string;
  password: string;
};

export type ProfileUpdateIn = { username?: string; display_name?: string; email?: string };

export type WorkspaceSettings = {
  public_id: string;
  id: number;
  name: string;
  telegram_manager_chat_id: string;
  telegram_staff_chat_id: string;
  telegram_team_chat_id: string;
  telegram_team_title: string;
  telegram_team_invite_link: string;
  mfa_policy: MfaPolicy;
  big_order_sen: number; // an order worth this much, or with big_order_lines lines, may have 2 PICs
  big_order_lines: number;
};

export type PackUnit = { unit: string; base_qty: number };

export type Category = {
  id: number;
  name: string;
  temp_min_c: number | null;
  temp_max_c: number | null;
};
export type CategoryIn = Omit<Category, "id">;

export type Product = {
  id: number;
  name: string;
  category_id: number;
  category: string;
  base_unit: string;
  temp_min_c: number | null;
  temp_max_c: number | null;
  effective_temp_min_c: number | null;
  effective_temp_max_c: number | null;
  min_stock: number;
  stock: number;
  sop: string;
  pack_units: PackUnit[];
  low_stock: boolean;
  archived: boolean; // left out of receiving; history kept
  code: string | null; // the POS / sales sheet code (SKU)
  barcode: string | null; // printed on the pack, scanned to pick the product
  track_expiry: boolean; // each delivery needs an expiry date
  min_days_left: number | null; // fewer days left at delivery: held for a manager
  warn_days: number; // everyone is told this many days before
};

export type ProductIn = {
  name: string;
  category_id: number;
  base_unit: string;
  temp_min_c: number | null;
  temp_max_c: number | null;
  min_stock: number;
  sop: string;
  pack_units: PackUnit[];
  code?: string | null;
  barcode?: string | null;
  track_expiry?: boolean;
  min_days_left?: number | null;
  warn_days?: number;
};

export type SopDraft = {
  sop: string;
  issues: { step: number | null; problem: string }[];
  checked: boolean; // false when the checking pass could not run
};

export type ProductSuggestion = {
  name: string;
  category: string | null;
  category_id: number | null; // an existing category with that name
  pack_size: string | null; // as printed, e.g. "10 pcs/ctn"; the units below come from it
  base_unit: string | null;
  pack_unit: string | null;
  units_per_pack: number | null;
  temp_min_c: number | null;
  temp_max_c: number | null;
  sop: string | null; // handling steps printed on the sheet
  warning: string | null;
  exists: boolean; // already in the catalogue
};

export type ExtractedLine = {
  name: string;
  quantity: number | null; // null: the model could not read it, staff fill it in
  unit: string | null;
  unit_price: number | null; // RM for one unit, as printed
  warning: string | null;
  product_id: number | null;
};

export type DeliveryStatus = "accepted" | "pending_approval" | "rejected" | "returned";

export type DeliveryLineIn = {
  product_id: number | null;
  name: string;
  quantity: number;
  unit: string;
  temp_c: number | null;
  expected_base_qty: number | null;
  unit_price_sen: number | null; // one delivered unit, as on the invoice
  expiry_on?: string | null; // YYYY-MM-DD, as printed on the pack
  expiry_later?: boolean; // cannot be seen yet: filled in on the lot later
};

// The server records who received it from the signed-in user.
export type DeliveryIn = {
  supplier: string;
  purchase_order_id?: number | null;
  lines: DeliveryLineIn[];
  /** JPEG base64 of the stock as it arrived, with what the photo shows. Up to 4. */
  photos?: { data: string; caption: string }[];
  /** Teammates to tag; each one is told in their inbox. */
  tagged_user_ids?: number[];
  /** The storage area it is put away in; the first one when left out. */
  storage_id?: number | null;
};

export type PhotoComment = { id: number; author: string; body: string; created_at: string };
export type DeliveryPhoto = { id: number; caption: string; comments: PhotoComment[] };

export type DeliveryLine = DeliveryLineIn & {
  id: number;
  received_base_qty: number | null;
  passed: boolean;
  issues: string[];
  /** Sent back while the rest of the delivery was accepted. */
  returned: boolean;
};

export type Delivery = {
  id: number;
  supplier: string;
  received_by: string;
  status: DeliveryStatus;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  purchase_order_id: number | null;
  purchase_order: string | null; // e.g. PO-0007
  lines: DeliveryLine[];
  photos: DeliveryPhoto[];
  tags: DeliveryTag[];
  storage: string | null; // "Outlet / Store"
};

export type DeliveryTag = { user_id: number; username: string; display_name: string; tagged_by: string; created_at: string };

// accept_passed: stock the lines that passed, send the failed ones back.
/** A supplier that Draft from low stock would order from, and the low-stock products it would get. */
export type LowStockSupplier = { supplier_id: number; name: string; products: string[]; has_product_list: boolean };
export type ReorderSuggestion = {
  product_id: number;
  product_name: string;
  base_unit: string;
  stock: number;
  min_stock: number;
  daily_use: number;
  days_left: number | null;
  on_order: number;
  quantity: number; // still to order after open orders
  reason: string;
};

export type Decision = "accept" | "accept_passed" | "reject" | "return";

// The server records who decided from the signed-in user.
export type DecisionIn = { decision: Decision; reason: string };

export type AuditEntry = {
  id: number;
  at: string;
  actor: string;
  action: string;
  delivery_id: number | null;
  detail: string;
  /** The account behind the action; null for "system" and entries from before accounts were logged. */
  actor_id: number | null;
};

export type StocktakeLineIn = {
  product_id: number;
  expected_stock: number;
  counted_stock: number;
};

export type StocktakeCreateIn = {
  count_date: string;
  storage_id?: number | null;
  notes: string;
  lines: StocktakeLineIn[];
};

export type StocktakeLine = {
  id: number;
  product_id: number | null;
  product_name: string;
  base_unit: string;
  expected_stock: number;
  counted_stock: number;
  difference: number;
};

export type Stocktake = {
  id: number;
  reference: string;
  count_date: string;
  counted_by: string;
  created_at: string;
  notes: string;
  line_count: number;
  changed_count: number;
  storage: string | null; // "Outlet / Store"; null for counts made before storage areas
};

export type StocktakeDetail = Stocktake & { lines: StocktakeLine[] };
export type CountGap = Omit<StocktakeLine, "id"> & {
  share: number | null; // difference / expected; null when 0 was expected
  earlier: number[]; // differences at earlier counts of the storage area, newest first
  pattern: "repeat" | "one_off" | "over";
  hint: string;
  value_sen: number | null; // the difference at the latest delivered price
};
export type PriceChange = {
  product_id: number;
  product_name: string;
  base_unit: string;
  supplier: string;
  before_sen: number; // per base unit
  now_sen: number;
  change: number; // now / before - 1
  delivery_id: number;
  received_at: string;
  previous_at: string;
};
export type AskAnswer = {
  topic: "waste" | "reorder" | "prices" | "approvals" | "use" | "help";
  text: string;
  items: string[];
  to: string | null; // the page with the details
};
export type CountInsights = { stocktake_id: number; reference: string; sales_recorded: boolean; gaps: CountGap[] };
export type GapExplanation = { summary: string; actions: string[] };
export type StocktakePreviewLine = Omit<StocktakeLine, "id" | "product_id"> & { product_id: number };
export type StocktakePreview = { lines: StocktakePreviewLine[] };
export type StocktakeProduct = {
  id: number;
  name: string;
  category: string;
  base_unit: string;
  stock: number;
  bundle_unit: string | null; // the largest pack size, counted as whole bundles
  bundle_qty: number | null;
};

export type DashboardSummary = {
  product_count: number;
  delivery_count: number;
  pending_count: number;
  accepted_count: number;
  rejected_count: number;
  returned_count: number;
  recent_deliveries: {
    id: number;
    supplier: string;
    status: DeliveryStatus;
    created_at: string;
    purchase_order: string | null;
  }[];
  low_stock_products: {
    id: number;
    name: string;
    stock: number;
    min_stock: number;
    base_unit: string;
  }[];
  recent_activity: { created_at: string; status: DeliveryStatus }[];
};

// ---- purchasing ----

export type Supplier = {
  id: number;
  name: string;
  contact: string;
  phone: string;
  email: string;
  archived: boolean;
  product_ids: number[]; // what they sell, from the catalogue
};
export type SupplierIn = Omit<Supplier, "id" | "archived">;

export type PurchaseOrderStatus = "draft" | "issued" | "cancelled";
export type ReceivingStatus = "not_received" | "partially_received" | "fully_received";

export type PurchaseOrderLine = {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit: string;
  base_unit: string;
  ordered_base_qty: number;
  received_base_qty: number; // on accepted deliveries
  pending_base_qty: number; // waiting for a manager
  outstanding_base_qty: number;
};

export type PurchaseOrder = {
  id: number;
  reference: string;
  supplier_id: number;
  supplier: string;
  status: PurchaseOrderStatus;
  receiving_status: ReceivingStatus;
  order_date: string;
  expected_date: string | null;
  notes: string;
  created_by: string;
  created_at: string;
  issued_by: string | null;
  issued_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  lines: PurchaseOrderLine[];
  delivery_ids: number[];
};

export type PurchaseOrderIn = {
  supplier_id: number;
  order_date: string;
  expected_date: string | null;
  notes: string;
  lines: { product_id: number; quantity: number; unit: string }[];
};

// ---- teammates, inbox and accountability --------------------------------------------------------

export type TeamMember = { id: number; username: string; display_name: string; role: Role };

export type NotificationKind = "tagged" | "approval_needed" | "decided" | "comment" | "sign_in" | "security" | "expiry";
export type Notification = {
  id: number;
  kind: NotificationKind;
  delivery_id: number | null;
  actor: string;
  body: string;
  created_at: string;
  read: boolean;
};
export type Inbox = { unread: number; items: Notification[] };

export type Accountability = {
  user_id: number;
  username: string;
  display_name: string;
  role: Role;
  active: boolean;
  received: number;
  decided: number;
  stock_counts: number;
  purchase_orders: number;
  comments: number;
  tagged: number;
  last_active: string | null;
  last_sign_in: string | null;
};

// ---- other ways to sign in ----------------------------------------------------------------------

export type SignInMethods = { google: boolean; telegram_bot_id: string | null };
export type Passkey = { id: number; name: string; created_at: string; last_used_at: string | null };
export type Security = {
  google_linked: boolean;
  telegram_linked: boolean;
  pin_set: boolean;
  passkeys: Passkey[];
  recent_sign_ins: SignIn[];
  team_group_title: string | null;
  team_group_link: string | null;
};
export type KitchenDevice = { id: number; name: string; created_by: string; created_at: string; last_used_at: string | null; this_device: boolean };
export type KitchenScreen = { device_name: string; workspace_name: string; people: { id: number; display_name: string }[] };
/** What Telegram's login page hands back: the person's id, profile fields and Telegram's hash. */
export type TelegramAuth = { id: number; auth_date: number; hash: string; [field: string]: string | number };

// ---- outlets, storage areas, transfers and sales ----

export type StorageArea = { id: number; name: string; outlet_id: number; outlet: string; label: string };
export type Outlet = { id: number; name: string; storages: StorageArea[] };
export type StockLevel = {
  product_id: number;
  name: string;
  code: string | null;
  barcode?: string | null;
  category: string;
  base_unit: string;
  quantity: number; // in the storage area
  total: number; // over every storage area
};
export type ProductQuantity = { product_id: number; quantity: number };
export type TransferIn = { from_storage_id: number; to_storage_id: number; notes: string; lines: ProductQuantity[] };
export type Transfer = {
  id: number;
  reference: string;
  from_storage: string;
  to_storage: string;
  moved_by: string;
  created_at: string;
  notes: string;
  lines: { product_id: number | null; product_name: string; base_unit: string; quantity: number }[];
};
export type SalePreview = {
  lines: { product_id: number; code: string; product_name: string; base_unit: string; quantity: number; in_stock: number }[];
  unknown_codes: string[];
};
export type SaleIn = { storage_id: number; sale_date: string; source: string; lines: ProductQuantity[] };
export type Sale = {
  id: number;
  reference: string;
  storage: string;
  sale_date: string;
  source: string;
  recorded_by: string;
  created_at: string;
  lines: { product_id: number | null; product_code: string; product_name: string; base_unit: string; quantity: number; deducted: number }[];
};

// ---- HQ and branches ----

export type WorkspaceRef = { id: number; public_id: string; name: string };
export type Links = { hq: WorkspaceRef | null; branches: WorkspaceRef[] };

export interface ApiKey {
  id: number;
  name: string;
  hint: string;
  storage: string;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
}

export type TaskKind = "daily" | "event";
export type TaskRole = "everyone" | "staff" | "manager";
export type TaskListIn = { name: string; kind: TaskKind; for_role: TaskRole; steps: string[] };
export type TaskList = TaskListIn & {
  id: number;
  ticks: { step: number; done_by: string; done_at: string }[]; // steps done on the day asked for
};

export type JobKind = "po" | "delivery" | "count";
export type Pic = { user_id: number; name: string };
export type Job = {
  kind: JobKind;
  ref_id: number;
  title: string;
  when: string; // what to do now
  due: string | null;
  days_left: number | null; // negative when late
  big: boolean;
  pics: Pic[];
  can_take: boolean;
  asked: boolean; // waiting for a manager to approve taking it over
  page: string;
  steps: string[]; // the SOP for this job, written by the server from the order's products
  ticks: { step: string; done_by: string }[];
};
export type AssignmentRequest = { id: number; kind: JobKind; ref_id: number; title: string; user_id: number; name: string; replaces: string[]; created_at: string };

export type Efficiency = {
  user_id: number;
  name: string;
  role: Role;
  jobs_due: number;
  jobs_on_time: number;
  deliveries: number;
  avg_days_late: number | null;
  lines_checked: number;
  lines_failed: number;
  counts: number;
  gap_sen_per_count: number | null;
};

export type LotStatus = "expired" | "soon" | "ok" | "no_date";
/** What is left of one received batch, where it is and where it came from. */
export type Lot = {
  id: number;
  code: string; // written on the box
  product_id: number;
  product: string;
  base_unit: string;
  storage_id: number;
  location: string;
  expiry_on: string | null;
  days_left: number | null;
  status: LotStatus;
  left: number;
  received: number;
  supplier: string;
  delivery_id: number | null;
  purchase_order: string | null;
  received_at: string;
};
export type DisposalMethod = "food_waste" | "donated" | "returned" | "general_waste";
export type Disposal = {
  id: number;
  lot_code: string | null;
  product: string;
  location: string;
  quantity: number;
  base_unit: string;
  method: DisposalMethod;
  value_sen: number | null;
  notes: string;
  disposed_by: string;
  created_at: string;
};
