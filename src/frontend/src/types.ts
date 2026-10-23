// Mirrors src/backend/app/models.py. Keep the two in step when the API changes.

export type Role = "owner" | "manager" | "staff";

export type Me = {
  id: number;
  username: string;
  email: string | null;
  display_name: string;
  role: Role;
  workspace: { id: number; name: string };
};

export type UserOut = {
  id: number;
  username: string;
  email: string | null;
  display_name: string;
  role: Role;
  active: boolean;
  created_at: string;
};

export type UserCreateIn = {
  username: string;
  display_name: string;
  email?: string;
  role: "manager" | "staff";
  password: string;
};

export type UserUpdateIn = {
  display_name?: string;
  email?: string;
  role?: "manager" | "staff";
  active?: boolean;
  password?: string;
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
