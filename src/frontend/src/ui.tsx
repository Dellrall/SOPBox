import type { ReactNode } from "react";
import type { DeliveryStatus } from "./types";

// Shared Tailwind class strings, so every screen looks the same.
export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-2 focus:outline-brand-600";
export const labelClass = "block text-sm font-medium text-slate-700";
export const primaryButton =
  "rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white shadow-sm hover:bg-brand-900 disabled:opacity-50";
export const secondaryButton =
  "rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50";
export const dangerButton =
  "rounded-lg border border-red-300 bg-white px-4 py-2.5 font-medium text-red-800 hover:bg-red-50 disabled:opacity-50";
export const cardClass = "rounded-xl border border-line bg-white p-4 shadow-sm";

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

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-semibold text-brand-900">{title}</h1>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-sm text-slate-600">{children}</p>;
}

export const when = (iso: string) => new Date(iso).toLocaleString();

export const ROLE_LABEL = { owner: "Owner", manager: "Manager", staff: "Staff" } as const;
