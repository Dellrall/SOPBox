import type { DeliveryStatus } from "./types";

// Shared Tailwind class strings, so every screen looks the same.
export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-teal-600 focus:outline-2 focus:outline-teal-600";
export const labelClass = "block text-sm font-medium text-slate-700";
export const primaryButton =
  "rounded-lg bg-teal-700 px-4 py-2.5 font-medium text-white hover:bg-teal-800 disabled:opacity-50";
export const secondaryButton =
  "rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50";
export const cardClass = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";

const STATUS: Record<DeliveryStatus, { label: string; style: string }> = {
  accepted: { label: "Accepted", style: "bg-emerald-100 text-emerald-900" },
  pending_approval: { label: "Waiting for a manager", style: "bg-amber-100 text-amber-900" },
  rejected: { label: "Rejected", style: "bg-red-100 text-red-900" },
  returned: { label: "Returned to supplier", style: "bg-red-100 text-red-900" },
};

/** Status is always written out, never colour alone. */
export function StatusBadge({ status }: { status: DeliveryStatus }) {
  const { label, style } = STATUS[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${style}`}>{label}</span>;
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
      {message}
    </p>
  );
}
