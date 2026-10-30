import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  AtSign,
  Ban,
  CheckCircle2,
  CreditCard,
  KeyRound,
  ClipboardList,
  ListChecks,
  Link2,
  Lock,
  Receipt,
  ShieldCheck,
  Store,
  Unlink,
  Warehouse,
  MessageSquare,
  Pencil,
  Send,
  Settings,
  ShoppingCart,
  Truck,
  Undo2,
  UserCog,
  UserPlus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { api } from "./api";
import { useTeam } from "./Tags";
import type { AuditEntry } from "./types";
import { Empty, ErrorNote, PageTitle, inputClass, labelClass, panelClass } from "./ui";
import { Select } from "./Select";

type Group = "deliveries" | "orders" | "stock" | "team";

const ACTIONS: Record<string, { label: string; group: Group; icon: LucideIcon; tone: string }> = {
  "delivery.received": { label: "Delivery checked", group: "deliveries", icon: Truck, tone: "bg-sky-50 text-sky-700" },
  "delivery.partly_accepted": { label: "Delivery partly accepted", group: "deliveries", icon: Undo2, tone: "bg-amber-50 text-amber-700" },
  "delivery.accepted": { label: "Delivery accepted", group: "deliveries", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
  "delivery.rejected": { label: "Delivery rejected", group: "deliveries", icon: XCircle, tone: "bg-red-50 text-red-700" },
  "delivery.returned": { label: "Delivery returned", group: "deliveries", icon: Undo2, tone: "bg-amber-50 text-amber-700" },
  "delivery.photo_comment": { label: "Commented on a photo", group: "deliveries", icon: MessageSquare, tone: "bg-slate-100 text-slate-600" },
  "delivery.tagged": { label: "Teammate tagged", group: "deliveries", icon: AtSign, tone: "bg-brand-50 text-brand-700" },
  "delivery.untagged": { label: "Tag removed", group: "deliveries", icon: AtSign, tone: "bg-slate-100 text-slate-600" },
  "po.created": { label: "Order drafted", group: "orders", icon: ShoppingCart, tone: "bg-brand-50 text-brand-700" },
  "po.updated": { label: "Order edited", group: "orders", icon: Pencil, tone: "bg-slate-100 text-slate-600" },
  "po.issued": { label: "Order issued", group: "orders", icon: Send, tone: "bg-brand-50 text-brand-700" },
  "po.cancelled": { label: "Order cancelled", group: "orders", icon: Ban, tone: "bg-red-50 text-red-700" },
  "stocktake.created": { label: "Stock counted", group: "stock", icon: ClipboardList, tone: "bg-violet-50 text-violet-700" },
  "stock.transferred": { label: "Stock moved", group: "stock", icon: ArrowLeftRight, tone: "bg-violet-50 text-violet-700" },
  "sales.recorded": { label: "Sales recorded", group: "stock", icon: Receipt, tone: "bg-violet-50 text-violet-700" },
  "outlet.created": { label: "Outlet added", group: "stock", icon: Store, tone: "bg-brand-50 text-brand-700" },
  "outlet.renamed": { label: "Outlet renamed", group: "stock", icon: Store, tone: "bg-slate-100 text-slate-600" },
  "outlet.deleted": { label: "Outlet deleted", group: "stock", icon: Store, tone: "bg-red-50 text-red-700" },
  "storage.created": { label: "Storage area added", group: "stock", icon: Warehouse, tone: "bg-brand-50 text-brand-700" },
  "storage.renamed": { label: "Storage area renamed", group: "stock", icon: Warehouse, tone: "bg-slate-100 text-slate-600" },
  "storage.deleted": { label: "Storage area deleted", group: "stock", icon: Warehouse, tone: "bg-red-50 text-red-700" },
  "assignment.added": { label: "PIC added", group: "team", icon: UserPlus, tone: "bg-brand-50 text-brand-700" },
  "assignment.removed": { label: "PIC removed", group: "team", icon: UserCog, tone: "bg-slate-100 text-slate-600" },
  "assignment.requested": { label: "Asked to take over", group: "team", icon: UserCog, tone: "bg-amber-50 text-amber-700" },
  "assignment.approved": { label: "Take-over approved", group: "team", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
  "assignment.declined": { label: "Take-over declined", group: "team", icon: XCircle, tone: "bg-red-50 text-red-700" },
  "count.planned": { label: "Count planned", group: "stock", icon: ClipboardList, tone: "bg-violet-50 text-violet-700" },
  "count.unplanned": { label: "Planned count removed", group: "stock", icon: ClipboardList, tone: "bg-slate-100 text-slate-600" },
  "task_list.created": { label: "Task list added", group: "team", icon: ListChecks, tone: "bg-brand-50 text-brand-700" },
  "task_list.updated": { label: "Task list changed", group: "team", icon: ListChecks, tone: "bg-slate-100 text-slate-600" },
  "task_list.deleted": { label: "Task list removed", group: "team", icon: ListChecks, tone: "bg-red-50 text-red-700" },
  "user.created": { label: "Account created", group: "team", icon: UserPlus, tone: "bg-slate-100 text-slate-600" },
  "user.updated": { label: "Account changed", group: "team", icon: UserCog, tone: "bg-slate-100 text-slate-600" },
  "team_group.connected": { label: "Team group changed", group: "team", icon: Send, tone: "bg-slate-100 text-slate-600" },
  "team_group.member": { label: "Team group", group: "team", icon: Send, tone: "bg-slate-100 text-slate-600" },
  "user.sign_in_method": { label: "Sign-in changed", group: "team", icon: KeyRound, tone: "bg-slate-100 text-slate-600" },
  "workspace.updated": { label: "Settings changed", group: "team", icon: Settings, tone: "bg-slate-100 text-slate-600" },
  "account.username_changed": { label: "Username changed", group: "team", icon: UserCog, tone: "bg-slate-100 text-slate-600" },
  "owner.transferred": { label: "Ownership handed over", group: "team", icon: UserCog, tone: "bg-amber-50 text-amber-700" },
  "mfa.enabled": { label: "Two-step sign-in turned on", group: "team", icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-700" },
  "mfa.disabled": { label: "Two-step sign-in turned off", group: "team", icon: ShieldCheck, tone: "bg-amber-50 text-amber-700" },
  "mfa.reset": { label: "Two-step sign-in reset", group: "team", icon: ShieldCheck, tone: "bg-amber-50 text-amber-700" },
  "mfa.backup_codes": { label: "New backup codes made", group: "team", icon: ShieldCheck, tone: "bg-slate-100 text-slate-600" },
  "api_key.created": { label: "Till key made", group: "team", icon: KeyRound, tone: "bg-slate-100 text-slate-600" },
  "api_key.revoked": { label: "Till key turned off", group: "team", icon: KeyRound, tone: "bg-red-50 text-red-700" },
  "hq.code_created": { label: "Branch link code made", group: "team", icon: Link2, tone: "bg-slate-100 text-slate-600" },
  "hq.linked": { label: "Linked to HQ", group: "team", icon: Link2, tone: "bg-brand-50 text-brand-700" },
  "hq.unlinked": { label: "Unlinked from HQ", group: "team", icon: Unlink, tone: "bg-amber-50 text-amber-700" },
  "hq.branch_removed": { label: "Branch unlinked", group: "team", icon: Unlink, tone: "bg-amber-50 text-amber-700" },
  "plan.changed": { label: "Plan changed", group: "team", icon: CreditCard, tone: "bg-brand-50 text-brand-700" },
  "plan.code_redeemed": { label: "Plan code redeemed", group: "team", icon: CreditCard, tone: "bg-brand-50 text-brand-700" },
  "plan.upgrade_requested": { label: "Upgrade requested", group: "team", icon: CreditCard, tone: "bg-slate-100 text-slate-600" },
  "workspace.closed": { label: "Business closed", group: "team", icon: Lock, tone: "bg-red-50 text-red-700" },
  "workspace.reopened": { label: "Business reopened", group: "team", icon: Lock, tone: "bg-emerald-50 text-emerald-700" },
};
const FALLBACK = { label: "", group: "team" as Group, icon: Settings, tone: "bg-slate-100 text-slate-600" };

const FILTERS: { id: Group | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "deliveries", label: "Deliveries" },
  { id: "orders", label: "Purchase orders" },
  { id: "stock", label: "Stock & outlets" },
  { id: "team", label: "Team & settings" },
];

/** An action this page has no name for yet still reads as words: "storage.created" -> "Storage created". */
const words = (action: string) => {
  const text = action.replace(/[._]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const describe = (a: AuditEntry) => ACTIONS[a.action] ?? { ...FALLBACK, label: words(a.action) };
const dayKey = (iso: string) => new Date(iso).toDateString();
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function dayLabel(iso: string): string {
  const day = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return "Today";
  if (day.toDateString() === yesterday.toDateString()) return "Yesterday";
  return day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Back-to-back identical entries (same person, action and detail) shown once with a count. */
function fold(rows: AuditEntry[]): { entry: AuditEntry; times: number }[] {
  const out: { entry: AuditEntry; times: number }[] = [];
  for (const a of rows) {
    const last = out[out.length - 1];
    const same =
      last && last.entry.actor === a.actor && last.entry.action === a.action && last.entry.detail === a.detail &&
      last.entry.delivery_id === a.delivery_id && dayKey(last.entry.at) === dayKey(a.at);
    if (same) last.times += 1;
    else out.push({ entry: a, times: 1 });
  }
  return out;
}

export default function Activity() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [filter, setFilter] = useState<Group | "all">("all");
  // One person's actions, by account (so a name change does not split their record).
  const [person, setPerson] = useState<number | undefined>(undefined);
  const [error, setError] = useState("");
  const team = useTeam();

  useEffect(() => {
    let live = true;
    setRows(null);
    api
      .audit(200, person)
      .then((r) => live && setRows(r))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [person]);

  const shown = fold((rows ?? []).filter((a) => filter === "all" || describe(a).group === filter));
  const days: { key: string; label: string; items: typeof shown }[] = [];
  for (const item of shown) {
    const key = dayKey(item.entry.at);
    if (days[days.length - 1]?.key !== key) days.push({ key, label: dayLabel(item.entry.at), items: [] });
    days[days.length - 1].items.push(item);
  }

  return (
    <div className="space-y-5">
      <PageTitle title="Activity log" />
      <ErrorNote message={error} />

      <div className="max-w-xs">
        <label className={labelClass} htmlFor="activity-person">
          Person
        </label>
        <Select
          id="activity-person"
          className={`${inputClass} py-2 text-sm`}
          value={person == null ? "" : String(person)}
          choices={[{ value: "", label: "Everyone" }, ...team.map((m) => ({ value: String(m.id), label: `${m.display_name} (@${m.username})` }))]}
          onChange={(v) => setPerson(v ? Number(v) : undefined)}
        />
      </div>

      <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
              filter === f.id ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-line hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows && shown.length === 0 && <Empty>{rows.length === 0 ? (person ? "No activity by this person yet." : "No activity yet.") : "Nothing of this kind yet."}</Empty>}

      {days.map((d) => (
        <section key={d.key} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{d.label}</h2>
          <ul className={`${panelClass} divide-y divide-line`}>
            {d.items.map(({ entry: a, times }) => {
              const { label, icon: Icon, tone } = describe(a);
              const detail = [a.delivery_id !== null ? `Delivery #${a.delivery_id}` : "", a.detail].filter(Boolean).join(" · ");
              return (
                <li key={a.id} className="flex items-start gap-3 px-4 py-2.5 sm:px-5">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}>
                    <Icon aria-hidden className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">
                      {label}
                      {times > 1 && (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">×{times}</span>
                      )}
                    </p>
                    {detail && <p className="break-words text-sm text-slate-600">{detail}</p>}
                  </div>
                  <p className="shrink-0 text-right text-xs text-muted">
                    <time dateTime={a.at}>{time(a.at)}</time>
                    <span className="block max-w-28 truncate sm:max-w-48">{a.actor}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
