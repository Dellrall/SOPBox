export type Role = 'employee' | 'admin';
export type Page = 'dashboard' | 'receiving' | 'records' | 'products' | 'approvals' | 'activity' | 'users';
export type Status = 'Draft' | 'Passed' | 'Pending Approval' | 'Accepted' | 'Rejected' | 'Returned';
export type Product = {
  id: string; name: string; category: string; base_unit: string;
  temp_min_c: number | null; temp_max_c: number | null;
  pack_units?: { unit: string; base_qty: number }[];
};
export type Line = {
  id: string; 
  product_id: string; 
  name: string; quantity: number; 
  unit: string;
  expected_base_qty: number | null; 
  temp_c: string;
  condition: 'Normal' | 'Abnormal'; 
  remarks: string; 
  photoName: string;
  photoData?: string;
};

export type Delivery = {
  id: string; 
  supplier: string; 
  po: string; 
  invoice: string; 
  createdAt: string;
  status: Status; 
  lines: Line[]; 
  issues: string[]; 
  decision?: string;
  documentName?: string;
  documentData?: string;
};

export type ApiCheck = {
  checks: { product_id: string; passed: boolean; issues: string[]; received_base_qty: number | null }[];
  needs_approval: boolean;
};

export type StaffAccount = {
  id: string;
  username: string;
  password: string; // Demo only; production must use backend authentication
  role: Role;
  active: boolean;
  permissions: Page[];
};

export const DEFAULT_STAFF_PERMISSIONS: Page[] = [
  'dashboard',
  'receiving',
  'records',
  'products',
];
