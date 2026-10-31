import { useEffect, useState } from "react";
import { Copy, Plus } from "lucide-react";
import { api } from "./api";
import type { Links, Outlet } from "./types";
import { DeleteIconButton, EditIconButton, ErrorNote, SectionTitle, SuccessNote, cardClass, dangerButton, inputClass, primaryButton, secondaryButton } from "./ui";

/** The outlets and a way to change them, shared by the outlet list and the storage areas. */
function useOutlets() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.outlets().then(setOutlets).catch((e: Error) => setError(e.message));
  }, []);

  async function run(action: () => Promise<Outlet[]>) {
    setError("");
    setBusy(true);
    try {
      setOutlets(await action());
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const rename = (current: string, save: (name: string) => Promise<Outlet[]>) => {
    const name = window.prompt(`Type the new name for “${current}”, then tap OK.`, current)?.trim();
    if (name && name !== current) void run(() => save(name));
  };
  return { outlets, error, busy, run, rename };
}

/** Managers add, rename and delete outlets (Settings, Workspace). Their storage areas are on Categories & storage. */
export function Outlets() {
  const { outlets, error, busy, run, rename } = useOutlets();
  const [newOutlet, setNewOutlet] = useState("");

  return (
    <section className={`${cardClass} space-y-4`}>
      <div>
        <SectionTitle>Outlets</SectionTitle>
        <p className="mt-1 text-sm text-muted">
          Each shop or kitchen of the business. Its storage areas (Store, Chiller…) are set up on the Categories &amp; storage page.
        </p>
      </div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {outlets.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink">{o.name}</span>
              <span className="block text-xs text-muted">
                {o.storages.length} storage area{o.storages.length === 1 ? "" : "s"}
              </span>
            </span>
            <EditIconButton label={`Rename ${o.name}`} disabled={busy} onClick={() => rename(o.name, (n) => api.renameOutlet(o.id, n))} />
            {outlets.length > 1 && (
              <DeleteIconButton
                label={`Delete ${o.name}`}
                disabled={busy}
                onClick={() => window.confirm(`Delete ${o.name}?`) && void run(() => api.deleteOutlet(o.id))}
              />
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const name = newOutlet.trim();
          if (name) void run(() => api.createOutlet(name)).then((ok) => ok && setNewOutlet(""));
        }}
      >
        <label className="sr-only" htmlFor="outlet-new">
          New outlet
        </label>
        <input
          id="outlet-new"
          maxLength={80}
          placeholder="New outlet, e.g. Outlet KL"
          className={`${inputClass} min-w-40 flex-1`}
          value={newOutlet}
          onChange={(e) => setNewOutlet(e.target.value)}
        />
        <button type="submit" className={primaryButton} disabled={busy}>
          Add outlet
        </button>
      </form>
      <ErrorNote message={error} />
    </section>
  );
}

/** Where stock sits in each outlet, e.g. Store and Substore. Managers add, rename and delete them. */
export function StorageAreas({ canEdit }: { canEdit: boolean }) {
  const { outlets, error, busy, run, rename } = useOutlets();
  const [newStorage, setNewStorage] = useState<Record<number, string>>({});

  return (
    <section className={`${cardClass} space-y-4`} aria-labelledby="storage-heading">
      <div>
        <h2 id="storage-heading" className="text-base font-bold text-brand-950">
          Storage areas
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Where stock is kept. Only an empty area with no history can be deleted.
        </p>
      </div>
      {outlets.map((o) => (
        <div key={o.id} className="space-y-2">
          {outlets.length > 1 && <p className="text-xs font-semibold uppercase tracking-wider text-muted">{o.name}</p>}
          <ul className="divide-y divide-line rounded-xl border border-line">
            {o.storages.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                <span className="flex-1 font-medium text-ink">{s.name}</span>
                {canEdit && (
                  <>
                    <EditIconButton label={`Rename ${s.label}`} disabled={busy} onClick={() => rename(s.name, (n) => api.renameStorage(s.id, n))} />
                    <DeleteIconButton
                      label={`Delete ${s.label}`}
                      disabled={busy}
                      onClick={() => window.confirm(`Delete ${s.label}?`) && void run(() => api.deleteStorage(s.id))}
                    />
                  </>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = (newStorage[o.id] ?? "").trim();
                if (name) void run(() => api.createStorage(o.id, name)).then((ok) => ok && setNewStorage((all) => ({ ...all, [o.id]: "" })));
              }}
            >
              <label className="sr-only" htmlFor={`storage-new-${o.id}`}>
                New storage area in {o.name}
              </label>
              <input
                id={`storage-new-${o.id}`}
                maxLength={80}
                placeholder="New storage area, e.g. Chiller"
                className={`${inputClass} min-w-40 flex-1`}
                value={newStorage[o.id] ?? ""}
                onChange={(e) => setNewStorage((all) => ({ ...all, [o.id]: e.target.value }))}
              />
              <button type="submit" className={secondaryButton} disabled={busy}>
                <Plus aria-hidden className="h-4 w-4" />
                Add
              </button>
            </form>
          )}
        </div>
      ))}
      <ErrorNote message={error} />
    </section>
  );
}

/** Owners link branch workspaces to an HQ with a one-time code. */
export function HqLinks() {
  const [links, setLinks] = useState<Links | null>(null);
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.links().then(setLinks).catch((e: Error) => setError(e.message));
  }, []);

  async function run(action: () => Promise<Links>, done: string) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      setLinks(await action());
      setNotice(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!links) return <ErrorNote message={error} />;
  return (
    <section className={`${cardClass} space-y-3`}>
      <div>
        <SectionTitle>HQ & branches</SectionTitle>
        <p className="mt-1 text-sm text-muted">
          Each workspace keeps its own team and records. Linked branches show up for HQ people in the workspace switcher: HQ
          owners and managers work there as managers, HQ staff with the access they have at HQ. Branch people never see HQ.
          Sign out and in again (or reload) after linking to see the switcher.
        </p>
      </div>
      {links.hq ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
          <span className="flex-1">
            This workspace is a branch of <strong className="text-ink">{links.hq.name}</strong>.
          </span>
          <button
            type="button"
            className={dangerButton}
            disabled={busy}
            onClick={() => window.confirm(`Unlink from ${links.hq!.name}? HQ people will lose access here.`) && void run(api.leaveHq, "Unlinked from HQ.")}
          >
            Unlink
          </button>
        </div>
      ) : (
        <>
          {links.branches.length > 0 && (
            <ul className="divide-y divide-line rounded-xl border border-line text-sm">
              {links.branches.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 font-medium text-ink">{b.name}</span>
                  <button
                    type="button"
                    className="text-red-700 underline"
                    disabled={busy}
                    onClick={() => window.confirm(`Unlink ${b.name}?`) && void run(() => api.removeBranch(b.id), `${b.name} unlinked.`)}
                  >
                    Unlink
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={() => {
                setError("");
                api.createLinkCode().then(setCode).catch((e: Error) => setError(e.message));
              }}
            >
              Make a branch link code
            </button>
            {code && (
              <div className="space-y-1 rounded-xl bg-brand-50 px-3 py-2.5 text-sm">
                <p>Give this to the branch owner. It works once, until {new Date(code.expires_at).toLocaleString()}, and is not shown again.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all font-mono text-ink" data-testid="link-code">
                    {code.code}
                  </code>
                  <button
                    type="button"
                    aria-label="Copy the code"
                    className="rounded-lg p-1.5 hover:bg-white"
                    onClick={() => void navigator.clipboard?.writeText(code.code)}
                  >
                    <Copy aria-hidden className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
          {links.branches.length === 0 && (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) void run(() => api.joinHq(typed.trim()), "Linked. HQ can now work in this workspace.").then(() => setTyped(""));
              }}
            >
              <label className="sr-only" htmlFor="hq-code">
                HQ link code
              </label>
              <input
                id="hq-code"
                autoComplete="off"
                maxLength={100}
                placeholder="Join an HQ: paste its link code"
                className={`${inputClass} min-w-40 flex-1`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
              <button type="submit" className={primaryButton} disabled={busy}>
                Join HQ
              </button>
            </form>
          )}
        </>
      )}
      {notice && <SuccessNote>{notice}</SuccessNote>}
      <ErrorNote message={error} />
    </section>
  );
}
