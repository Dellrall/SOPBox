import { useEffect, useState } from "react";
import { AtSign, X } from "lucide-react";
import { api } from "./api";
import type { Delivery, TeamMember } from "./types";
import { ErrorNote, inputClass } from "./ui";
import { Select } from "./Select";

// The team changes rarely: fetch it once per visit to the app and share it.
let teamRequest: Promise<TeamMember[]> | null = null;

export function useTeam(): TeamMember[] {
  const [team, setTeam] = useState<TeamMember[]>([]);
  useEffect(() => {
    teamRequest ??= api.team().catch(() => {
      teamRequest = null; // try again next time
      return [];
    });
    let live = true;
    void teamRequest.then((t) => live && setTeam(t));
    return () => {
      live = false;
    };
  }, []);
  return team;
}

function Chip({ name, onRemove, removeLabel }: { name: string; onRemove?: () => void; removeLabel: string }) {
  return (
    <li className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1.5 text-sm font-medium text-brand-800 ring-1 ring-brand-200">
      <AtSign aria-hidden className="h-3.5 w-3.5" />
      {name}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={removeLabel} className="rounded-full p-0.5 hover:bg-brand-100">
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

/** Pick teammates to tag. Shows the picked ones as chips; the select offers the rest. */
export function TagPicker({
  value,
  onChange,
  id,
  disabled,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  id: string;
  disabled?: boolean;
}) {
  const team = useTeam();
  const left = team.filter((m) => !value.includes(m.id));
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tagged teammates">
          {value.map((uid) => {
            const name = team.find((m) => m.id === uid)?.display_name ?? "Teammate";
            return <Chip key={uid} name={name} removeLabel={`Untag ${name}`} onRemove={disabled ? undefined : () => onChange(value.filter((v) => v !== uid))} />;
          })}
        </ul>
      )}
      {left.length > 0 && (
        <Select
          id={id}
          className={`${inputClass} py-2 text-sm`}
          value=""
          disabled={disabled}
          choices={[{ value: "", label: "Tag a teammate…" }, ...left.map((m) => ({ value: String(m.id), label: `${m.display_name} (@${m.username})` }))]}
          onChange={(v) => v && onChange([...value, Number(v)])}
        />
      )}
    </div>
  );
}

/** Who is tagged on a saved delivery, with tagging and untagging. Changes are logged and notified. */
export function DeliveryTags({ delivery, onChanged }: { delivery: Delivery; onChanged: (d: Delivery) => void }) {
  const team = useTeam();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tagged = new Set(delivery.tags.map((t) => t.user_id));
  const left = team.filter((m) => !tagged.has(m.id));

  async function run(change: () => Promise<Delivery>) {
    setBusy(true);
    setError("");
    try {
      onChanged(await change());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Tagged teammates" className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-700">Tagged</h4>
      {delivery.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {delivery.tags.map((t) => (
            <Chip
              key={t.user_id}
              name={t.display_name}
              removeLabel={`Untag ${t.display_name}`}
              onRemove={busy ? undefined : () => void run(() => api.untagTeammate(delivery.id, t.user_id))}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nobody yet. Tag a teammate to let them know, or type @username in a photo comment.</p>
      )}
      {left.length > 0 && (
        <Select
          aria-label={`Tag a teammate on delivery #${delivery.id}`}
          className={`${inputClass} max-w-xs py-2 text-sm`}
          value=""
          disabled={busy}
          choices={[{ value: "", label: "Tag a teammate…" }, ...left.map((m) => ({ value: String(m.id), label: `${m.display_name} (@${m.username})` }))]}
          onChange={(v) => v && void run(() => api.tagTeammates(delivery.id, [Number(v)]))}
        />
      )}
      <ErrorNote message={error} />
    </section>
  );
}
