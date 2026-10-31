import type { InputHTMLAttributes, ReactNode } from "react";
import { useMascotSad } from "./Mascot";
import { Inbox, Pencil, Trash2 } from "lucide-react";
import type { DeliveryStatus } from "./types";

/** A temperature field with a ± button: the iPhone number keypad has no minus key. */
export function TempInput({
  value,
  onChange,
  className = inputClass,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "inputMode"> & { value: string; onChange: (value: string) => void }) {
  const negative = value.trim().startsWith("-");
  return (
    <div className="flex min-w-0 gap-1.5">
      <button
        type="button"
        aria-label="Minus"
        aria-pressed={negative}
        title="Switch between minus and plus"
        onClick={() => onChange(negative ? value.trim().slice(1) : `-${value.trim()}`)}
        className={`min-w-11 shrink-0 rounded-xl border px-2 text-lg font-bold transition ${
          negative ? "border-sky-600 bg-sky-50 text-sky-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        ±
      </button>
      {/* Some keyboards type a typographic minus; the API wants "-". */}
      <input {...rest} inputMode="decimal" className={`${className} min-w-0 flex-1`} value={value} onChange={(e) => onChange(e.target.value.replace(/[−–]/g, "-"))} />
    </div>
  );
}

// Shared Tailwind class strings, so every screen looks the same.
export const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-ink sm:py-2.5 shadow-xs transition placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/15";
export const labelClass = "mb-1 block text-sm font-semibold text-slate-700";
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition sm:px-4 sm:py-2.5 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
export const primaryButton = `${button} bg-brand-600 text-white shadow-sm shadow-brand-900/20 hover:bg-brand-700`;
export const secondaryButton = `${button} border border-slate-300 bg-white text-slate-800 shadow-xs hover:border-slate-400 hover:bg-slate-50`;
export const dangerButton = `${button} border border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-50`;
/** A white panel without padding, for lists whose rows set their own. */
export const panelClass = "rounded-2xl border border-line bg-white shadow-sm shadow-brand-950/[0.03]";
export const cardClass = `${panelClass} p-4 sm:p-5`;

export const STATUS_LABEL = (s: DeliveryStatus) => STATUS[s].label;
const STATUS: Record<DeliveryStatus, { label: string; style: string; dot: string }> = {
  accepted: { label: "Accepted", style: "bg-emerald-50 text-emerald-800 ring-emerald-600/20", dot: "bg-emerald-500" },
  pending_approval: { label: "Waiting for a manager", style: "bg-amber-50 text-amber-800 ring-amber-600/20", dot: "bg-amber-500" },
  rejected: { label: "Rejected", style: "bg-red-50 text-red-800 ring-red-600/20", dot: "bg-red-500" },
  returned: { label: "Returned to supplier", style: "bg-red-50 text-red-800 ring-red-600/20", dot: "bg-red-500" },
};

/** Status is always written out, never colour alone. */
export function StatusBadge({ status }: { status: DeliveryStatus }) {
  const { label, style, dot } = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${style}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

export function ErrorNote({ message }: { message: string }) {
  useMascotSad(message);
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
      {message}
    </p>
  );
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-900">
      {children}
    </p>
  );
}

export function PageTitle({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-6 sm:items-end">
      <div>
        <h1 className="text-2xl font-bold text-brand-950 sm:text-[1.7rem]">{title}</h1>
        {/* Phones skip the subtitle: the page name and the bottom bar already say where you are. */}
        {subtitle && <p className="mt-1 hidden max-w-2xl text-sm text-muted sm:block">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-base font-bold text-brand-950">{children}</h2>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-8 text-center text-sm text-muted">
      <Inbox aria-hidden className="h-6 w-6 text-slate-400" />
      <p>{children}</p>
    </div>
  );
}

export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export const ROLE_LABEL = { owner: "Owner", manager: "Manager", staff: "Staff" } as const;
/** The role as people say it: an assistant is a manager with the assistant flag. */
export const roleLabel = (u: { role: keyof typeof ROLE_LABEL; assistant?: boolean }) =>
  u.role === "manager" && u.assistant ? "Assistant manager" : ROLE_LABEL[u.role];

const iconButton =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition disabled:pointer-events-none disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:h-9 sm:w-9";

/** A pencil for rename or edit; `label` says what, for screen readers and the tooltip. */
export function EditIconButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={`${iconButton} text-slate-600 hover:bg-slate-100 hover:text-ink`}>
      <Pencil aria-hidden className="h-4 w-4" />
    </button>
  );
}

/** A red bin for delete; `label` says what, for screen readers and the tooltip. */
export function DeleteIconButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={`${iconButton} text-red-600 hover:bg-red-50 hover:text-red-700`}>
      <Trash2 aria-hidden className="h-4 w-4" />
    </button>
  );
}
