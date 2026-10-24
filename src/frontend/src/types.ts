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

export type Me = {
  id: number;
  username: string;
  email: string | null;
  display_name: string;
  role: Role;
  section_access: SectionAccess;
  workspace: { id: number; name: string };
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
};

export type UserCreateIn = {
  username: string;
  display_name: string;
  email?: string;
  role: "manager" | "staff";
  password: string;
  section_access?: SectionAccess;
};

export type UserUpdateIn = {
  display_name?: string;
  email?: string;
  role?: "manager" | "staff";
  active?: boolean;
  password?: string;
  section_access?: SectionAccess;
};

export type RegisterIn = {
  workspace_name: string;
  display_name: string;
  email: string;
  username: string;
  password: string;
};

export type ProfileUpdateIn = { display_name?: string; email?: string };

export type WorkspaceSettings = {
  id: number;
  name: string;
  telegram_manager_chat_id: string;
  telegram_staff_chat_id: string;
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
  warning: string | null;
  exists: boolean; // already in the catalogue
};

export type ExtractedLine = {
  name: string;
  quantity: number | null; // null: the model could not read it, staff fill it in
  unit: string | null;
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
};

// The server records who received it from the signed-in user.
export type DeliveryIn = {
  supplier: string;
  purchase_order_id?: number | null;
  lines: DeliveryLineIn[];
};

export type DeliveryLine = DeliveryLineIn & {
  id: number;
  received_base_qty: number | null;
  passed: boolean;
  issues: string[];
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
};

export type Decision = "accept" | "reject" | "return";

// The server records who decided from the signed-in user.
export type DecisionIn = { decision: Decision; reason: string };

export type AuditEntry = {
  id: number;
  at: string;
  actor: string;
  action: string;
  delivery_id: number | null;
  detail: string;
};

export type StocktakeLineIn = {
  product_id: number;
  expected_stock: number;
  counted_stock: number;
};

export type StocktakeCreateIn = {
  count_date: string;
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
};

export type StocktakeDetail = Stocktake & { lines: StocktakeLine[] };
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
