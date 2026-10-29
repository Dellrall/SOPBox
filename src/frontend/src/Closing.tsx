import { useState } from "react";
import { api } from "./api";
import { saveExport } from "./Billing";
import type { Me } from "./types";
import { ErrorNote, SectionTitle, cardClass, dangerButton, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/** On every page while the business is closed: nothing can be changed, and when it all goes. */
export function ClosedBanner({ me, onOpen }: { me: Me; onOpen: () => void }) {
  if (!me.closing.delete_on) return null;
  return (
    <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 print:hidden">
      <strong>This business is closed.</strong> Nothing can be changed, and everything is deleted for good on{" "}
      <strong>{day(me.closing.delete_on)}</strong>.{" "}
      <button type="button" className="font-semibold underline" onClick={onOpen}>
        {me.role === "owner" ? "Download your data or reopen it" : "Download your data"}
      </button>
    </div>
  );
}

/**
 * The owner closes the business: first a copy of the data, then the name typed again. It stays
 * read-only for 30 days, when it can still be reopened, and is then deleted for good.
 */
export function CloseBusiness({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [noCopy, setNoCopy] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const download = () => run(async () => (await saveExport(), setDownloaded(true)));

  if (me.closing.delete_on)
    return (
      <section className={`${cardClass} space-y-3`}>
        <SectionTitle>Business closed</SectionTitle>
        <p className="text-sm text-muted">
          Everything in {me.workspace.name} is deleted for good on <strong className="text-ink">{day(me.closing.delete_on)}</strong>. Until
          then you can download a copy, or reopen it and carry on as before.
        </p>
        <ErrorNote message={error} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => void download()}>
            Download your data
          </button>
          <button
            type="button"
            className={primaryButton}
            disabled={busy}
            onClick={() => void run(async () => (await api.reopenWorkspace(), onChanged()))}
          >
            Reopen the business
          </button>
        </div>
      </section>
    );

  const ready = (downloaded || noCopy) && name.trim() === me.workspace.name;
  const shut = () => {
    setOpen(false);
    setName("");
    setError("");
  };
  return (
    <section aria-labelledby="danger-zone" className="space-y-3">
      <h3 id="danger-zone" className="text-lg font-bold text-red-700">
        Danger zone
      </h3>
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-red-200 bg-white p-5">
        <div className="min-w-0 flex-1 basis-64">
          <p className="font-semibold text-ink">Close this business</p>
          <p className="mt-1 text-sm text-muted">
            Stops the business on SOPBox. Read-only for 30 days, then its records, team and settings are deleted for good.
          </p>
        </div>
        <button type="button" className={dangerButton} onClick={() => setOpen(true)}>
          Close this business
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-brand-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-title"
          onKeyDown={(e) => e.key === "Escape" && shut()}
        >
          <div className={`${cardClass} my-auto w-full max-w-lg space-y-4`}>
            <div>
              <h2 id="close-title" className="text-lg font-bold text-ink">
                Close {me.workspace.name}?
              </h2>
              <p className="mt-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-200">
                Only do this if the business has stopped trading. Everyone keeps read-only access for 30 days and you can reopen it until
                then; after that, everything is deleted for good. Selling it or handing it on? Ask SOPBox support to move it to the new
                owner instead.
              </p>
            </div>
            <ol className="list-decimal space-y-3 pl-5 text-sm">
              <li>
                <p className="mb-2">Download a copy first. You may need the records later, for tax for example, and SOPBox will not keep one.</p>
                <button type="button" className={secondaryButton} disabled={busy} onClick={() => void download()}>
                  {downloaded ? "Downloaded ✓" : "Download your data"}
                </button>
                {!downloaded && (
                  <label className="mt-2 flex items-center gap-2 text-muted">
                    <input type="checkbox" checked={noCopy} onChange={(e) => setNoCopy(e.target.checked)} />I do not need a copy
                  </label>
                )}
              </li>
              <li>
                <label className={labelClass} htmlFor="close-name">
                  Type {me.workspace.name} to confirm
                </label>
                <input id="close-name" autoFocus className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
              </li>
            </ol>
            <ErrorNote message={error} />
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={secondaryButton} disabled={busy} onClick={shut}>
                Cancel
              </button>
              <button
                type="button"
                className={dangerButton}
                disabled={busy || !ready}
                onClick={() => void run(async () => (await api.closeWorkspace(name.trim()), onChanged()))}
              >
                I understand, close the business
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
