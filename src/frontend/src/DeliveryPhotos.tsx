import { useState } from "react";
import { Download, MessageSquare } from "lucide-react";
import { api } from "./api";
import type { Delivery } from "./types";
import { ErrorNote, inputClass, secondaryButton } from "./ui";

const shortWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** One photo: the picture, what it shows, and the team's comments on it. */
function Photo({ delivery, index, onChanged }: { delivery: Delivery; index: number; onChanged: (d: Delivery) => void }) {
  const photo = delivery.photos[index];
  const url = api.photoUrl(delivery.id, photo.id);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      onChanged(await api.commentOnPhoto(delivery.id, photo.id, draft.trim()));
      setDraft("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="overflow-hidden rounded-xl border border-line bg-white">
      <a href={url} target="_blank" rel="noreferrer" title="Open the full photo">
        <img src={url} alt={photo.caption || `Photo ${index + 1} of delivery #${delivery.id}`} loading="lazy" className="aspect-[4/3] w-full bg-slate-100 object-cover" />
      </a>
      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-ink">
            <span className="font-semibold">Photo {index + 1}.</span>{" "}
            {photo.caption || <span className="text-muted">No description</span>}
          </p>
          <a href={url} download={`delivery-${delivery.id}-photo-${index + 1}.jpg`} className="shrink-0 rounded-lg p-1 text-brand-700 hover:bg-slate-100" aria-label={`Download photo ${index + 1}`}>
            <Download aria-hidden className="h-4 w-4" />
          </a>
        </div>
        {photo.comments.length > 0 && (
          <ul className="space-y-1.5 border-l-2 border-brand-100 pl-3">
            {photo.comments.map((c) => (
              <li key={c.id} className="text-sm">
                <span className="font-semibold text-ink">{c.author}</span>{" "}
                <span className="text-xs text-muted">{shortWhen(c.created_at)}</span>
                <p className="break-words text-slate-700">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            className={`${inputClass} min-w-0 flex-1 py-2 text-sm`}
            aria-label={`Comment on photo ${index + 1}`}
            placeholder="Add a comment… (@username tags a teammate)"
            maxLength={1000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className={`${secondaryButton} px-3 py-2`} disabled={busy || !draft.trim()} aria-label={`Post comment on photo ${index + 1}`}>
            <MessageSquare aria-hidden className="h-4 w-4" />
          </button>
        </form>
        <ErrorNote message={error} />
      </div>
    </li>
  );
}

/** The photos staff took while receiving, for whoever approves or follows up with the supplier. */
export default function DeliveryPhotos({ delivery, onChanged }: { delivery: Delivery; onChanged: (d: Delivery) => void }) {
  if (delivery.photos.length === 0) return null;
  return (
    <section aria-label="Photos of the stock" className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-700">Photos of the stock ({delivery.photos.length})</h4>
      <ul className="grid gap-3 sm:grid-cols-2">
        {delivery.photos.map((p, i) => (
          <Photo key={p.id} delivery={delivery} index={i} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}
