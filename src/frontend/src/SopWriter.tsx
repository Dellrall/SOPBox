import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { api } from "./api";
import type { ProductIn, SopDraft } from "./types";
import { ErrorNote, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

/**
 * Rough notes in, a checked SOP draft out. One AI pass writes the steps from the notes and the
 * product's rules; a second pass checks them and lists anything invented or left out. The
 * manager decides: nothing reaches the SOP box until they press "Use this SOP".
 */
export default function SopWriter({
  rules,
  onUse,
}: {
  rules: () => Omit<ProductIn, "sop"> | string;
  onUse: (sop: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<SopDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function write() {
    setError("");
    const product = rules();
    if (typeof product === "string") return setError(`Before writing: ${product}`);
    if (!notes.trim()) return setError("Type your notes first, for example: keep frozen, reject if thawed, check expiry.");
    setBusy(true);
    setDraft(null);
    try {
      const { min_stock: _, ...facts } = product;
      setDraft(await api.draftSop({ ...facts, notes: notes.trim() }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button type="button" className={`${secondaryButton} mt-2`} onClick={() => setOpen(true)}>
        <Sparkles aria-hidden className="h-4 w-4" /> Write the SOP with AI
      </button>
    );

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
      <div>
        <label className={labelClass} htmlFor="sop-notes">
          Your notes
        </label>
        <textarea
          id="sop-notes"
          rows={3}
          maxLength={2000}
          className={inputClass}
          placeholder="keep frozen, reject if thawed or box is wet, check expiry, store bottom shelf"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted">The AI uses only these notes and this product's rules. A second AI then checks the draft.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButton} disabled={busy} onClick={() => void write()}>
          {busy ? (
            <>
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Writing, then checking… (up to 3 min if the AI was asleep)
            </>
          ) : (
            <>
              <Sparkles aria-hidden className="h-4 w-4" /> {draft ? "Write again" : "Write SOP"}
            </>
          )}
        </button>
        <button type="button" className={secondaryButton} disabled={busy} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <ErrorNote message={error} />

      {draft && (
        <div className="space-y-3 rounded-lg border border-line bg-white p-3">
          <p className="whitespace-pre-line text-sm text-ink">{draft.sop}</p>
          {!draft.checked ? (
            <p className="flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" /> The checking AI could not run. Read every step before using it.
            </p>
          ) : draft.issues.length === 0 ? (
            <p className="flex items-start gap-2 text-sm text-emerald-800">
              <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" /> Checked: every step comes from your notes or the product's rules.
            </p>
          ) : (
            <div className="text-sm text-amber-900">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle aria-hidden className="h-4 w-4" /> The checking AI found {draft.issues.length} {draft.issues.length === 1 ? "thing" : "things"} to look at:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-6">
                {draft.issues.map((issue, i) => (
                  <li key={i}>
                    {issue.step !== null && <strong>Step {issue.step}: </strong>}
                    {issue.problem}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            className={primaryButton}
            onClick={() => {
              onUse(draft.sop);
              setOpen(false);
              setDraft(null);
            }}
          >
            Use this SOP
          </button>
          <p className="text-xs text-muted">It replaces the SOP box above. You can still edit it before saving the product.</p>
        </div>
      )}
    </div>
  );
}
