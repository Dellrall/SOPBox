import type {
  AuditEntry,
  DecisionIn,
  Delivery,
  DeliveryIn,
  DeliveryStatus,
  ExtractedLine,
  Product,
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
      return body.detail.map((d: { msg: string }) => d.msg).join("; ");
    }
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `HTTP ${res.status}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return (await res.json()) as T;
}

const postJson = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

export const api = {
  products: (q = "") => request<Product[]>(`/products${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  extract: (image_b64: string) => request<ExtractedLine[]>("/extract", postJson({ image_b64 })),
  createDelivery: (body: DeliveryIn) => request<Delivery>("/deliveries", postJson(body)),
  deliveries: (status?: DeliveryStatus) =>
    request<Delivery[]>(`/deliveries${status ? `?status=${status}` : ""}`),
  decide: (id: number, body: DecisionIn, pin: string) =>
    request<Delivery>(`/deliveries/${id}/decision`, postJson(body, { "X-Manager-Pin": pin })),
  audit: (limit = 10) => request<AuditEntry[]>(`/audit?limit=${limit}`),
};
