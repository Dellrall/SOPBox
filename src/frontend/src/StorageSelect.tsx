import { useEffect, useState } from "react";
import { api } from "./api";
import type { StorageArea } from "./types";
import { inputClass, labelClass } from "./ui";
import { Select } from "./Select";

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

/** The outlet picked in the sidebar: pages start on its storage areas. */
let currentOutlet: number | null = null;
export const setCurrentOutlet = (id: number | null) => {
  currentOutlet = id;
};

/** The storage area used when none is picked: the first one made in the current outlet, else in the workspace. */
export const firstStorageId = (storages: StorageArea[]) => {
  const here = storages.filter((s) => s.outlet_id === currentOutlet);
  const from = here.length ? here : storages;
  return from.length ? Math.min(...from.map((s) => s.id)) : null;
};

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
      <Select
        id={id}
        className={inputClass}
        value={value == null ? "" : String(value)}
        choices={[
          ...(value === null ? [{ value: "", label: "Choose…" }] : []),
          ...outlets.flatMap(([outletId, outlet]) =>
            storages.filter((s) => s.outlet_id === outletId).map((s) => ({ value: String(s.id), label: s.label, group: outlet })),
          ),
        ]}
        onChange={(v) => v && onChange(Number(v))}
      />
    </div>
  );
}
