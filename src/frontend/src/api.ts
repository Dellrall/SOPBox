import type {
  AuditEntry,
  Category,
  CategoryIn,
  DecisionIn,
  Delivery,
  DeliveryIn,
  DeliveryStatus,
  ExtractedLine,
  Me,
  Product,
  ProductIn,
  ProfileUpdateIn,
  ProductSuggestion,
  PurchaseOrder,
  PurchaseOrderIn,
  PurchaseOrderStatus,
  RegisterIn,
  Supplier,
  SupplierIn,
  UserCreateIn,
  UserOut,
  UserUpdateIn,
  WorkspaceSettings,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    // FastAPI validation errors arrive as a list of { msg } objects.
    if (Array.isArray(body.detail)) {
      return body.detail.map((d: { msg: string }) => d.msg.replace(/^Value error, /, "")).join("; ");
    }
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `HTTP ${res.status}`;
}

// Called when the server says the session has ended, so the app can show the sign-in page.
let onSignedOut: () => void = () => undefined;
export const setSignedOutHandler = (fn: () => void) => {
  onSignedOut = fn;
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    // A wrong password is also a 401, but that is not a lost session.
    if (res.status === 401 && !path.startsWith("/auth/login")) onSignedOut();
    throw new ApiError(res.status, await errorMessage(res));
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = (path: string) => request<void>("DELETE", path);

export const api = {
  // accounts
  me: () => get<Me>("/auth/me"),
  session: () => get<Me | null>("/auth/session"),
  login: (username: string, password: string) => post<Me>("/auth/login", { username, password }),
  register: (body: RegisterIn) => post<Me>("/auth/register", body),
  logout: () => post<void>("/auth/logout"),
  updateProfile: (body: ProfileUpdateIn) => patch<Me>("/auth/me", body),
  changePassword: (current_password: string, new_password: string) =>
    post<void>("/auth/password", { current_password, new_password }),
  users: () => get<UserOut[]>("/users"),
  createUser: (body: UserCreateIn) => post<UserOut>("/users", body),
  updateUser: (id: number, body: UserUpdateIn) => patch<UserOut>(`/users/${id}`, body),
  workspace: () => get<WorkspaceSettings>("/workspace"),
  updateWorkspace: (body: Partial<Omit<WorkspaceSettings, "id">>) =>
    patch<WorkspaceSettings>("/workspace", body),

  // catalogue
  categories: () => get<Category[]>("/categories"),
  createCategory: (body: CategoryIn) => post<Category>("/categories", body),
  updateCategory: (id: number, body: CategoryIn) => put<Category>(`/categories/${id}`, body),
  deleteCategory: (id: number) => del(`/categories/${id}`),
  products: (q = "") => get<Product[]>(`/products${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  createProduct: (body: ProductIn) => post<Product>("/products", body),
  updateProduct: (id: number, body: ProductIn) => put<Product>(`/products/${id}`, body),
  deleteProduct: (id: number) => del(`/products/${id}`),
  setArchived: (id: number, archived: boolean) => patch<Product>(`/products/${id}`, { archived }),
  createProducts: (products: ProductIn[]) => post<Product[]>("/products/bulk", { products }),
  countStock: (lines: { product_id: number; counted: number }[]) => post<Product[]>("/stock-counts", { lines }),
  readProductSheet: (image_b64: string) => post<ProductSuggestion[]>("/products/read-sheet", { image_b64 }),

  // receiving
  extract: (image_b64: string) => post<ExtractedLine[]>("/extract", { image_b64 }),
  createDelivery: (body: DeliveryIn) => post<Delivery>("/deliveries", body),
  deliveries: (status?: DeliveryStatus, limit = 50) =>
    get<Delivery[]>(`/deliveries?limit=${limit}${status ? `&status=${status}` : ""}`),
  decide: (id: number, body: DecisionIn) => post<Delivery>(`/deliveries/${id}/decision`, body),
  audit: (limit = 50) => get<AuditEntry[]>(`/audit?limit=${limit}`),

  // purchasing
  suppliers: () => get<Supplier[]>("/suppliers"),
  createSupplier: (body: SupplierIn) => post<Supplier>("/suppliers", body),
  updateSupplier: (id: number, body: SupplierIn) => put<Supplier>(`/suppliers/${id}`, body),
  setSupplierArchived: (id: number, archived: boolean) => patch<Supplier>(`/suppliers/${id}`, { archived }),
  purchaseOrders: (status?: PurchaseOrderStatus) =>
    get<PurchaseOrder[]>(`/purchase-orders${status ? `?status=${status}` : ""}`),
  purchaseOrder: (id: number) => get<PurchaseOrder>(`/purchase-orders/${id}`),
  createPurchaseOrder: (body: PurchaseOrderIn) => post<PurchaseOrder>("/purchase-orders", body),
  updatePurchaseOrder: (id: number, body: PurchaseOrderIn) => put<PurchaseOrder>(`/purchase-orders/${id}`, body),
  issuePurchaseOrder: (id: number) => post<PurchaseOrder>(`/purchase-orders/${id}/issue`),
  cancelPurchaseOrder: (id: number, reason: string) => post<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { reason }),
  lowStockDraft: (supplier_id: number, order_date: string) =>
    post<PurchaseOrder>("/purchase-orders/low-stock-draft", { supplier_id, order_date }),
};
