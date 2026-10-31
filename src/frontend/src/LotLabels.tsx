import { useEffect, useState } from "react";
import { api } from "./api";
import { labelsDoc } from "./Expiry";
import { PrintButton } from "./Print";
import type { Lot } from "./types";

/** After a delivery is stocked: the lot codes to write or stick on its boxes. */
export function LotLabels({ deliveryId }: { deliveryId: number }) {
  const [lots, setLots] = useState<Lot[]>([]);
  useEffect(() => {
    api
      .lots()
      .then((all) => setLots(all.filter((l) => l.delivery_id === deliveryId)))
      .catch(() => setLots([]));
  }, [deliveryId]);
  if (!lots.length) return null;
  return (
    <div className="space-y-2 rounded-xl bg-brand-50 p-3 text-sm text-brand-950">
      <p>
        Write the lot code and expiry on each box:{" "}
        {lots.map((l) => `${l.product} ${l.code}`).join(", ")}. New stock goes behind; the earliest date goes in front.
      </p>
      <PrintButton label="Print labels" doc={() => labelsDoc(lots, `Lot labels, delivery #${deliveryId}`)} />
    </div>
  );
}
