// Mirrors src/backend/app/models.py. Keep the two in step when the API changes.

export type PackUnit = { unit: string; base_qty: number };

export type Product = {
  id: number;
  name: string;
  category_id: number;
  category: string;
  base_unit: string;
  effective_temp_min_c: number | null;
  effective_temp_max_c: number | null;
  min_stock: number;
  stock: number;
  sop: string;
  pack_units: PackUnit[];
  low_stock: boolean;
};

export type ExtractedLine = {
  name: string;
  quantity: number;
  unit: string;
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

export type DeliveryIn = {
  supplier: string;
  received_by: string;
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

export type DecisionIn = { decision: Decision; decided_by: string; reason: string };

export type AuditEntry = {
  id: number;
  at: string;
  actor: string;
  action: string;
  delivery_id: number | null;
  detail: string;
};
