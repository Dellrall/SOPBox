import type {
  Plan,
  Pricing,
  ApiKey,
  KitchenDevice,
  KitchenScreen,
  Passkey,
  Security,
  SignInMethods,
  TelegramAuth,
  Accountability,
  AuditEntry,
  Inbox,
  TeamMember,
  Category,
  CategoryIn,
  Closing,
  DashboardSummary,
  DecisionIn,
  Delivery,
  DeliveryIn,
  DeliveryStatus,
  ExtractedLine,
  LowStockSupplier,
  Me,
  Product,
  ProductIn,
  ProductSuggestion,
  ProfileUpdateIn,
  PurchaseOrder,
  PurchaseOrderIn,
  PurchaseOrderStatus,
  RegisterIn,
  SopDraft,
  Stocktake,
  StocktakeCreateIn,
  StocktakeDetail,
  StocktakePreview,
  StocktakeProduct,
  Supplier,
  SupplierIn,
  UserCreateIn,
  UserOut,
  UserUpdateIn,
  WorkspaceSettings,
  Links,
  Outlet,
  Sale,
  SaleIn,
  SalePreview,
  StockLevel,
  Transfer,
  TransferIn,
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

// The branch an HQ person is working in (null: their own workspace). Sent on every call; the
// server checks it and ignores it on account routes.
let branchId: number | null = null;
export const setBranch = (id: number | null) => {
  branchId = id;
};
const branchHeader = (): Record<string, string> => (branchId === null ? {} : { "X-SOPBox-Workspace": String(branchId) });

// Asked when the server wants a fresh authenticator code (HTTP 428): shows the code box and
// resolves true once a code was accepted, so the request is sent again once.
let askForCode: () => Promise<boolean> = async () => false;
export const setCodeHandler = (fn: () => Promise<boolean>) => {
  askForCode = fn;
};

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...branchHeader(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    // A wrong password is also a 401, but that is not a lost session.
    if (res.status === 401 && !path.startsWith("/auth/login")) onSignedOut();
    if (res.status === 428 && retry && !path.startsWith("/auth/mfa/") && (await askForCode())) return request<T>(method, path, body, false);
    throw new ApiError(res.status, await errorMessage(res));
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api${path}`, { method: "POST", body: form, headers: branchHeader() });
  if (!res.ok) {
    if (res.status === 401) onSignedOut();
    throw new ApiError(res.status, await errorMessage(res));
  }
  return (await res.json()) as T;
}

async function download(path: string, retry = true): Promise<Blob> {
  const res = await fetch(`/api${path}`, { headers: branchHeader() });
  if (!res.ok) {
    if (res.status === 401) onSignedOut();
    if (res.status === 428 && retry && (await askForCode())) return download(path, false);
    throw new ApiError(res.status, await errorMessage(res));
  }
  return res.blob();
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
  mfaSetup: () => post<{ secret: string; uri: string }>("/auth/mfa/setup"),
  mfaEnable: (code: string) => post<{ backup_codes: string[] }>("/auth/mfa/enable", { code }),
  mfaVerify: (code: string) => post<Me>("/auth/mfa/verify", { code }),
  mfaDisable: () => request<void>("DELETE", "/auth/mfa"),
  mfaBackupCodes: () => post<{ backup_codes: string[] }>("/auth/mfa/backup-codes"),
  usernameAvailable: (username: string) =>
    get<{ username: string; available: boolean; problem: string }>(`/auth/username-available?username=${encodeURIComponent(username)}`),
  updateProfile: (body: ProfileUpdateIn) => patch<Me>("/auth/me", body),
  changePassword: (current_password: string, new_password: string) =>
    post<void>("/auth/password", { current_password, new_password }),
  signInMethods: () => get<SignInMethods>("/auth/methods"),
  security: () => get<Security>("/auth/security"),
  passkeyRegisterOptions: () => post<Record<string, unknown>>("/auth/passkeys/register-options"),
  addPasskey: (credential: unknown, name: string) => post<Passkey>("/auth/passkeys", { credential, name }),
  removePasskey: (id: number) => del(`/auth/passkeys/${id}`),
  passkeyLoginOptions: () => post<Record<string, unknown>>("/auth/passkeys/login-options"),
  passkeyLogin: (credential: unknown) => post<Me>("/auth/passkeys/login", { credential }),
  telegramLogin: (data: TelegramAuth) => post<Me>("/auth/telegram/login", data),
  telegramLink: (data: TelegramAuth) => post<void>("/auth/telegram/link", data),
  unlink: (provider: "google" | "telegram") => del(`/auth/${provider}`),
  setPin: (pin: string | null) => put<void>("/auth/pin", { pin }),
  kitchenScreen: () => get<KitchenScreen | null>("/auth/kitchen"),
  forgetKitchenTablet: () => del("/auth/kitchen"),
  kitchenLogin: (user_id: number, pin: string) => post<Me>("/auth/kitchen/login", { user_id, pin }),
  kitchenDevices: () => get<KitchenDevice[]>("/kitchen-devices"),
  addKitchenDevice: (name: string) => post<KitchenDevice>("/kitchen-devices", { name }),
  removeKitchenDevice: (id: number) => del(`/kitchen-devices/${id}`),
  users: () => get<UserOut[]>("/users"),
  createUser: (body: UserCreateIn) => post<UserOut>("/users", body),
  updateUser: (id: number, body: UserUpdateIn) => patch<UserOut>(`/users/${id}`, body),
  team: () => get<TeamMember[]>("/team"),
  accountability: () => get<Accountability[]>("/team/accountability"),
  inbox: () => get<Inbox>("/inbox"),
  markRead: (ids?: number[]) => post<void>("/inbox/read", { ids: ids ?? null }),
  workspace: () => get<WorkspaceSettings>("/workspace"),
  connectTeamGroup: (chat_id: string) => put<WorkspaceSettings>("/workspace/team-group", { chat_id }),
  disconnectTeamGroup: () => request<WorkspaceSettings>("DELETE", "/workspace/team-group"),
  removeFromTeamGroup: (id: number, hours: 1 | 24 | 168 | null) => post<UserOut>(`/users/${id}/team-group/remove`, { hours }),
  letBackIntoTeamGroup: (id: number) => post<UserOut>(`/users/${id}/team-group/let-back`),
  updateWorkspace: (body: Partial<Pick<WorkspaceSettings, "name" | "telegram_manager_chat_id" | "telegram_staff_chat_id" | "mfa_policy">>) =>
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
  draftSop: (body: Omit<ProductIn, "sop" | "min_stock"> & { notes: string }) => post<SopDraft>("/products/sop-draft", body),
  readProductSheet: (image_b64: string) => post<ProductSuggestion[]>("/products/read-sheet", { image_b64 }),

  // receiving
  extract: (image_b64: string) => post<ExtractedLine[]>("/extract", { image_b64 }),
  createDelivery: (body: DeliveryIn) => post<Delivery>("/deliveries", body),
  deliveries: (status?: DeliveryStatus, limit = 50) =>
    get<Delivery[]>(`/deliveries?limit=${limit}${status ? `&status=${status}` : ""}`),
  decide: (id: number, body: DecisionIn) => post<Delivery>(`/deliveries/${id}/decision`, body),
  // An <img> cannot send the branch header, so the branch rides in the address.
  photoUrl: (deliveryId: number, photoId: number) =>
    `/api/deliveries/${deliveryId}/photos/${photoId}${branchId === null ? "" : `?workspace=${branchId}`}`,
  commentOnPhoto: (deliveryId: number, photoId: number, body: string) =>
    post<Delivery>(`/deliveries/${deliveryId}/photos/${photoId}/comments`, { body }),
  tagTeammates: (deliveryId: number, user_ids: number[]) => post<Delivery>(`/deliveries/${deliveryId}/tags`, { user_ids }),
  untagTeammate: (deliveryId: number, userId: number) => request<Delivery>("DELETE", `/deliveries/${deliveryId}/tags/${userId}`),
  audit: (limit = 50, actorId?: number) => get<AuditEntry[]>(`/audit?limit=${limit}${actorId ? `&actor_id=${actorId}` : ""}`),
  dashboard: () => get<DashboardSummary>("/dashboard"),

  // stock count and stocktake
  stocktakes: () => get<Stocktake[]>("/stocktakes"),
  stocktakeProducts: (storageId?: number) =>
    get<StocktakeProduct[]>(`/stocktakes/products${storageId ? `?storage_id=${storageId}` : ""}`),
  stocktake: (id: number) => get<StocktakeDetail>(`/stocktakes/${id}`),
  createStocktake: (body: StocktakeCreateIn) => post<StocktakeDetail>("/stocktakes", body),
  previewStocktake: (file: File, storageId?: number) =>
    upload<StocktakePreview>(`/stocktakes/preview${storageId ? `?storage_id=${storageId}` : ""}`, file),
  stocktakeTemplate: () => download("/stocktakes/template.xlsx"),

  // outlets, storage areas, transfers and sales
  outlets: () => get<Outlet[]>("/outlets"),
  createOutlet: (name: string) => post<Outlet[]>("/outlets", { name }),
  renameOutlet: (id: number, name: string) => put<Outlet[]>(`/outlets/${id}`, { name }),
  deleteOutlet: (id: number) => request<Outlet[]>("DELETE", `/outlets/${id}`),
  createStorage: (outlet_id: number, name: string) => post<Outlet[]>("/storages", { outlet_id, name }),
  renameStorage: (id: number, name: string) => put<Outlet[]>(`/storages/${id}`, { name }),
  deleteStorage: (id: number) => request<Outlet[]>("DELETE", `/storages/${id}`),
  stockIn: (storageId: number) => get<StockLevel[]>(`/storages/${storageId}/stock`),
  transfers: () => get<Transfer[]>("/transfers"),
  createTransfer: (body: TransferIn) => post<Transfer>("/transfers", body),
  sales: () => get<Sale[]>("/sales"),
  previewSales: (file: File, storageId: number) => upload<SalePreview>(`/sales/preview?storage_id=${storageId}`, file),
  createSale: (body: SaleIn) => post<Sale>("/sales", body),
  salesTemplate: () => download("/sales/template.csv"),
  exportData: () => download("/export"),
  closeWorkspace: (workspace_name: string) => post<Closing>("/workspace/close", { workspace_name }),
  reopenWorkspace: () => post<Closing>("/workspace/reopen"),

  // API keys for a till (owners and managers)
  apiKeys: () => get<ApiKey[]>("/api-keys"),
  createApiKey: (name: string, storage_id: number) => post<ApiKey & { key: string }>("/api-keys", { name, storage_id }),
  revokeApiKey: (id: number) => request<ApiKey[]>("DELETE", `/api-keys/${id}`),

  // HQ and branches (owners)
  links: () => get<Links>("/workspace/links"),
  createLinkCode: () => post<{ code: string; expires_at: string }>("/workspace/link-codes"),
  joinHq: (code: string) => post<Links>("/workspace/hq", { code }),
  leaveHq: () => request<Links>("DELETE", "/workspace/hq"),
  removeBranch: (id: number) => request<Links>("DELETE", `/workspace/branches/${id}`),

  // plans, sales and support
  pricing: () => get<Pricing>("/pricing"),
  plan: () => get<Plan>("/plan"),
  redeemPlanCode: (code: string) => post<Plan>("/plan/redeem", { code }),
  salesInquiry: (body: { topic: "sales" | "question"; name: string; company: string; email: string; phone: string; outlets: number | null; message: string }) =>
    post<{ id: number }>("/inquiries", body),
  upgradeRequest: (body: { billing: "annual" | "lifetime"; outlets: number; customization: boolean; priority_support: boolean; phone: string; message: string }) =>
    post<{ id: number }>("/plan/upgrade-request", body),
  support: (message: string) => post<{ id: number; priority: boolean }>("/support", { message }),

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
  lowStockSuppliers: () => get<LowStockSupplier[]>("/purchase-orders/low-stock-suppliers"),
  lowStockDraft: (supplier_id: number, order_date: string) =>
    post<PurchaseOrder>("/purchase-orders/low-stock-draft", { supplier_id, order_date }),
};
