import { useEffect, useState } from "react";
import { api } from "./api";
import type { StorageArea } from "./types";
import { inputClass, labelClass } from "./ui";

/** Every storage area in the workspace, outlet by outlet. Empty until loaded. */
export function useStorages(): StorageArea[] {
  const [storages, setStorages] = useState<StorageArea[]>([]);
  useEffect(() => {
    api
      .outlets()
      .then((outlets) => setStorages(outlets.flatMap((o) => o.storages)))
      .catch(() => setStorages([]));
  }, []);
  return storages;
}

/** The server's default storage area (the first one made), used when none is picked. */
export const firstStorageId = (storages: StorageArea[]) =>
  storages.length ? Math.min(...storages.map((s) => s.id)) : null;

/** Pick a storage area, grouped by outlet. */
export function StorageSelect({
  id,
  label,
  storages,
  value,
  onChange,
}: {
  id: string;
  label: string;
  storages: StorageArea[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  const outlets = [...new Map(storages.map((s) => [s.outlet_id, s.outlet])).entries()];
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <select id={id} className={inputClass} value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
        {value === null && <option value="">Choose…</option>}
        {outlets.map(([outletId, outlet]) => (
          <optgroup key={outletId} label={outlet}>
            {storages
              .filter((s) => s.outlet_id === outletId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
