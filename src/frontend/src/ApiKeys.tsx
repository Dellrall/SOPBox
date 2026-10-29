import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { api } from "./api";
import { StorageSelect, firstStorageId, useStorages } from "./StorageSelect";
import type { ApiKey } from "./types";
import { ErrorNote, SectionTitle, cardClass, inputClass, labelClass, secondaryButton } from "./ui";

/** Keys a till (POS) uses to send sales and read stock for one storage area. */
export function ApiKeys() {
  const storages = useStorages();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [storageId, setStorageId] = useState<number | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = storageId ?? firstStorageId(storages);
  const origin = window.location.origin;

  useEffect(() => {
    api.apiKeys().then(setKeys).catch((e: Error) => setError(e.message));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || chosen === null) return;
    setError("");
    setBusy(true);
    try {
      const key = await api.createApiKey(name.trim(), chosen);
      setMade(key.key);
      setName("");
      setKeys(await api.apiKeys());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKey) {
    if (!window.confirm(`Revoke ${key.name}? Anything using it stops working at once.`)) return;
    setError("");
    try {
      setKeys(await api.revokeApiKey(key.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className={`${cardClass} space-y-3`}>
      <div>
        <SectionTitle>API keys for your till</SectionTitle>
        <p className="mt-1 text-sm text-muted">
          A till or other system can send sales by product code and read stock, for one storage area, without anyone signing
          in. A key can do nothing else. Send the same receipt number again and nothing changes, so a till can safely retry.
        </p>
      </div>
      <ErrorNote message={error} />
      {keys.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line text-sm">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{k.name}</span>{" "}
                <span className="text-muted">
                  ···{k.hint} · {k.storage} · {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleString()}` : "never used"}
                </span>
              </span>
              <button type="button" className="text-red-700 underline" onClick={() => void revoke(k)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => void create(e)}>
        <div>
          <label className={labelClass} htmlFor="api-key-name">
            Key name
          </label>
          <input
            id="api-key-name"
            maxLength={60}
            placeholder="e.g. Till 1, KL"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <StorageSelect id="api-key-storage" label="Sales come off" storages={storages} value={chosen} onChange={setStorageId} />
        <button type="submit" className={secondaryButton} disabled={busy || !name.trim() || chosen === null}>
          Make a key
        </button>
      </form>
      {made && (
        <div className="space-y-2 rounded-xl bg-brand-50 px-3 py-2.5 text-sm">
          <p>Copy this key into your till now. It is not shown again.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all font-mono text-ink" data-testid="api-key">
              {made}
            </code>
            <button
              type="button"
              aria-label="Copy the key"
              className="rounded-lg p-1.5 hover:bg-white"
              onClick={() => void navigator.clipboard?.writeText(made)}
            >
              <Copy aria-hidden className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-ink">How a till uses a key</summary>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-100 p-3 font-mono text-xs">{`POST ${origin}/api/v1/sales
Authorization: Bearer <key>
Content-Type: application/json

{"sale_date": "2026-10-29", "reference": "RECEIPT-123",
 "lines": [{"code": "1001", "quantity": 3}]}

GET ${origin}/api/v1/stock
Authorization: Bearer <key>`}</pre>
        <p className="mt-1 text-muted">
          The reply lists any codes no product has; those are left out. Set product codes in Products &amp; SOP.
        </p>
      </details>
    </section>
  );
}
