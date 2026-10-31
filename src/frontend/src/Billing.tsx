import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { price } from "./Pricing";
import type { Plan, Pricing } from "./types";
import { ErrorNote, SectionTitle, SuccessNote, cardClass, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";
import { Select } from "./Select";

/** The workspace's plan, and for the owner a request to upgrade (the team turns it on after payment). */
export function PlanCard({ owner }: { owner: boolean }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [form, setForm] = useState({
    billing: "annual" as "annual" | "lifetime",
    outlets: 2,
    customization: false,
    priority_support: false,
    phone: "",
    message: "",
  });
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [redeemed, setRedeemed] = useState(false);

  useEffect(() => {
    api
      .plan()
      .then(setPlan)
      .catch((e: Error) => setError(e.message));
    api
      .pricing()
      .then(setPricing)
      .catch(() => undefined);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.upgradeRequest(form);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function redeem(e: FormEvent) {
    e.preventDefault();
    setCodeError("");
    try {
      setPlan(await api.redeemPlanCode(code));
      setCode("");
      setRedeemed(true);
    } catch (err) {
      setCodeError((err as Error).message);
    }
  }

  if (!plan) return <ErrorNote message={error} />;
  const extras = [
    plan.api_access && "till API keys",
    plan.hq_links && "HQ links",
    plan.customization && "customization",
    plan.priority_support && "priority support",
  ].filter(Boolean);
  return (
    <section className={`${cardClass} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle>Plan &amp; billing</SectionTitle>
        <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800">{plan.label}</span>
        {plan.pre_alpha && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Pre-alpha user</span>
        )}
      </div>
      <p className="text-sm text-muted">
        Outlets: {plan.outlets_used} of {plan.outlets_allowed ?? "unlimited"}.
        {plan.billing === "annual" && plan.until && ` Paid until ${new Date(plan.until).toLocaleDateString()}.`}
        {plan.billing === "lifetime" && " Paid for life."}
        {extras.length > 0 && ` Includes ${extras.join(", ")}.`}
      </p>
      <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
        This month so far: <b>{plan.active_outlets}</b> outlet{plan.active_outlets === 1 ? "" : "s"} with work recorded
        {plan.bill_sen !== null && (
          <>
            , so this month&apos;s bill is <b>RM {(plan.bill_sen / 100).toFixed(2)}</b>
          </>
        )}
        . An outlet with no deliveries, counts, orders or sales in a month is not charged.
      </p>
      {plan.lapsed && (
        <p className="text-sm font-semibold text-amber-800">
          Your yearly plan has run out, so the workspace works as Free until it is renewed. Nothing was deleted.
        </p>
      )}
      {plan.pre_alpha && (
        <p className="text-sm text-muted">
          Thank you for being here early. Everything you set up before plans keeps working; adding more follows your plan.
        </p>
      )}
      <p className="text-sm">
        <a href="/pricing" className="font-semibold text-brand-700 underline">
          See prices
        </a>
      </p>
      {owner && plan.plan !== "enterprise" && (
        <form onSubmit={(e) => void redeem(e)} className="space-y-2 border-t border-line pt-3">
          <label className="block text-sm font-semibold text-ink" htmlFor="plan-code">
            Have a code from SOPBox?
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="plan-code"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              placeholder="PRO-XXXX-XXXX-XXXX-XXXX"
              className={`${inputClass} min-w-48 flex-1 font-mono uppercase`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="submit" className={secondaryButton} disabled={!code.trim()}>
              Redeem
            </button>
          </div>
          {redeemed && <SuccessNote>Code redeemed: {plan.label} is on.</SuccessNote>}
          <ErrorNote message={codeError} />
        </form>
      )}
      {owner &&
        plan.plan !== "enterprise" &&
        (sent ? (
          <SuccessNote>Request sent. We will contact you about payment and turn the plan on.</SuccessNote>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="space-y-3 border-t border-line pt-3">
            <p className="text-sm font-semibold text-ink">Ask to upgrade to Pro</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="up-billing">
                  Pay
                </label>
                <Select
                  id="up-billing"
                  className={inputClass}
                  value={form.billing}
                  choices={[
                    { value: "annual", label: `Monthly, by use (${price(pricing, "pro_month")} + ${price(pricing, "pro_outlet_month")} per extra active outlet)` },
                    // Offered only while plans.py has a price for it.
                    ...(pricing?.prices.pro_outlet_lifetime == null
                      ? []
                      : [{ value: "lifetime", label: `Lifetime, once (${price(pricing, "pro_outlet_lifetime")} per outlet, then AI reads only; needs approval)` }]),
                  ]}
                  onChange={(v) => setForm({ ...form, billing: v as "annual" | "lifetime" })}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="up-outlets">
                  Outlets in total
                </label>
                <input
                  id="up-outlets"
                  type="number"
                  min={1}
                  max={10000}
                  required
                  className={inputClass}
                  value={form.outlets}
                  onChange={(e) => setForm({ ...form, outlets: Number(e.target.value) })}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.customization} onChange={(e) => setForm({ ...form, customization: e.target.checked })} />
              Custom work: own checks, reports, SOP templates (quoted per task)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.priority_support}
                onChange={(e) => setForm({ ...form, priority_support: e.target.checked })}
              />
              Priority support ({price(pricing, "priority_support_year")} a year, first year free at launch)
            </label>
            <div>
              <label className={labelClass} htmlFor="up-phone">
                Phone (optional)
              </label>
              <input
                id="up-phone"
                type="tel"
                maxLength={40}
                autoComplete="tel"
                className={inputClass}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <ErrorNote message={error} />
            <button type="submit" className={primaryButton}>
              Send upgrade request
            </button>
          </form>
        ))}
    </section>
  );
}

/** Anyone can download their own account and what their sections show, as a ZIP of CSV files. */
export function ExportCard() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function exportData() {
    setError("");
    setBusy(true);
    try {
      await saveExport();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${cardClass} space-y-3`}>
      <SectionTitle>Download your data</SectionTitle>
      <p className="text-sm text-muted">
        A ZIP with your account, sign-ins and inbox, and a spreadsheet (CSV) for each part of SOPBox you can see. Passwords, PINs and
        two-step secrets are never included. The owner is told when someone downloads.
      </p>
      <ErrorNote message={error} />
      <button type="button" className={primaryButton} disabled={busy} onClick={() => void exportData()}>
        {busy ? "Preparing…" : "Download my data"}
      </button>
    </section>
  );
}

/** Download the ZIP of everything this person may see (export.py) and save it. */
export async function saveExport() {
  const url = URL.createObjectURL(await api.exportData());
  const link = document.createElement("a");
  link.href = url;
  link.download = `sopbox-export-${new Date().toISOString().slice(0, 10)}.zip`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Anyone can ask for help; workspaces with priority support are answered first. */
export function SupportCard() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState<null | boolean>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      setSent((await api.support(message)).priority);
      setMessage("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={`${cardClass} space-y-3`}>
      <SectionTitle>Get help</SectionTitle>
      <p className="text-sm text-muted">
        This goes to the SOPBox team, not your manager. We reply to the email on your account. For help with your outlet's
        work, ask your manager.
      </p>
      <div>
        <label className={labelClass} htmlFor="support-message">
          What do you need help with?
        </label>
        <textarea
          id="support-message"
          required
          rows={3}
          maxLength={4000}
          className={inputClass}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
      <ErrorNote message={error} />
      {sent !== null && <SuccessNote>{sent ? "Sent with priority. We will reply first." : "Sent. We will reply by email."}</SuccessNote>}
      <button type="submit" className={primaryButton}>
        Send
      </button>
    </form>
  );
}
