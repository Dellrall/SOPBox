import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { ArrowLeft, Check, Heart } from "lucide-react";
import { api } from "./api";
import type { PublicPath } from "./App";
import type { Pricing as PricingData } from "./types";
import { ErrorNote, SuccessNote, cardClass, inputClass, labelClass, primaryButton, secondaryButton } from "./ui";

/** A price from plans.py, or "TBC" while it is not decided. */
export const price = (p: PricingData | null, key: string) => {
  const value = p?.prices[key];
  return value == null ? "TBC" : `${p!.currency} ${value.toLocaleString()}`;
};

const FREE = [
  "One outlet, with any number of storage areas",
  "Your whole team",
  "AI delivery-order reading",
  "Stock, transfers, counts and sales upload",
  "Two-step sign-in",
];
const PRO = ["Everything in Free", "More outlets, priced per outlet", "HQ and branch links", "Till API keys"];
const ENTERPRISE = ["Everything in Pro", "Customization included", "Priority support included", "A price for your whole group"];

function Tier({
  name,
  price: amount,
  note,
  items,
  children,
}: {
  name: string;
  price: string;
  note: string;
  items: string[];
  children?: React.ReactNode;
}) {
  return (
    <section className={`${cardClass} flex flex-col gap-3`}>
      <h2 className="text-lg font-semibold text-ink">{name}</h2>
      <p>
        <span className="text-2xl font-bold text-ink">{amount}</span> <span className="text-sm text-muted">{note}</span>
      </p>
      <ul className="flex-1 space-y-1.5 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            {item}
          </li>
        ))}
      </ul>
      {children}
    </section>
  );
}

function ContactSales({ pricing }: { pricing: PricingData | null }) {
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", outlets: "", message: "" });
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.salesInquiry({ ...form, outlets: form.outlets ? Number(form.outlets) : null });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section id="contact-sales" className={`${cardClass} space-y-3`}>
      <h2 className="text-lg font-semibold text-ink">Contact sales</h2>
      <p className="text-sm text-muted">
        For groups with many outlets, or anything the plans above do not cover. Leave your details and our sales team will contact you.
        {pricing?.sales_email && (
          <>
            {" "}
            Email{" "}
            <a className="font-semibold text-brand-700 underline" href={`mailto:${pricing.sales_email}`}>
              {pricing.sales_email}
            </a>
          </>
        )}
        {pricing?.sales_phone && (
          <>
            {" "}
            or call{" "}
            <a className="font-semibold text-brand-700 underline" href={`tel:${pricing.sales_phone.replace(/\s/g, "")}`}>
              {pricing.sales_phone}
            </a>
          </>
        )}
        {(pricing?.sales_email || pricing?.sales_phone) && "."}
      </p>
      {sent ? (
        <SuccessNote>Thank you. Our sales team will contact you soon.</SuccessNote>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["name", "Your name", "text", true, "name"],
              ["company", "Business name", "text", false, "organization"],
              ["email", "Email", "email", true, "email"],
              ["phone", "Phone", "tel", false, "tel"],
              ["outlets", "Number of outlets", "number", false, "off"],
            ] as const
          ).map(([key, label, type, required, autoComplete]) => (
            <div key={key}>
              <label className={labelClass} htmlFor={`sales-${key}`}>
                {label}
              </label>
              <input
                id={`sales-${key}`}
                type={type}
                required={required}
                min={type === "number" ? 1 : undefined}
                maxLength={type === "number" ? undefined : key === "phone" ? 40 : 254}
                autoComplete={autoComplete}
                className={inputClass}
                value={form[key]}
                onChange={(e) => set({ [key]: e.target.value })}
              />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="sales-message">
              What do you need?
            </label>
            <textarea
              id="sales-message"
              rows={3}
              maxLength={4000}
              className={inputClass}
              value={form.message}
              onChange={(e) => set({ message: e.target.value })}
            />
          </div>
          <ErrorNote message={error} />
          <button type="submit" className={`${primaryButton} sm:col-span-2 sm:justify-self-start`}>
            Send to sales
          </button>
        </form>
      )}
    </section>
  );
}

/** The public pricing page: Free for one store, Pro per outlet, Enterprise through sales. */
export default function Pricing({ navigate, signedIn }: { navigate: (to: PublicPath) => void; signedIn: boolean }) {
  const [pricing, setPricing] = useState<PricingData | null>(null);

  useEffect(() => {
    document.title = "Pricing · SOPBox";
    api
      .pricing()
      .then(setPricing)
      .catch(() => setPricing(null));
  }, []);

  const go = (to: PublicPath) => (e: MouseEvent) => {
    e.preventDefault();
    navigate(to);
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <a href="/" onClick={go("/")} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
        <ArrowLeft aria-hidden className="h-4 w-4" /> {signedIn ? "Back to SOPBox" : "SOPBox"}
      </a>
      <div>
        <h1 className="text-3xl font-bold text-ink">Pricing</h1>
        <p className="mt-2 text-muted">Free for one store. Pay only when you grow, per outlet, for a year or once for life.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Tier name="Free" price="RM 0" note="for one store" items={FREE}>
          {!signedIn && (
            <a href="/register" onClick={go("/register")} className={primaryButton}>
              Create a workspace
            </a>
          )}
        </Tier>
        <Tier name="Pro" price={price(pricing, "pro_outlet_year")} note="per extra outlet, a year" items={PRO}>
          <p className="text-sm text-muted">Or {price(pricing, "pro_outlet_lifetime")} per extra outlet, once, for life.</p>
          {signedIn && <p className="text-sm text-muted">Upgrade from Settings, Plan &amp; billing.</p>}
        </Tier>
        <Tier name="Enterprise" price="Talk to us" note="" items={ENTERPRISE}>
          <a href="#contact-sales" className={secondaryButton}>
            Contact sales
          </a>
        </Tier>
      </div>
      <section className={`${cardClass} space-y-2 text-sm`}>
        <h2 className="text-lg font-semibold text-ink">Add-ons for Pro</h2>
        <p>
          <strong className="text-ink">Customization</strong>: your own branding, fields and checks, SOP templates and reports.{" "}
          {price(pricing, "customization_year")} a year, or {price(pricing, "customization_lifetime")} for life.
        </p>
        <p>
          <strong className="text-ink">Priority support</strong>: your questions answered first. {price(pricing, "priority_support_year")} a
          year. Everyone else can still ask for help from Settings.
        </p>
      </section>
      <ContactSales pricing={pricing} />
      {pricing?.kofi_url && (
        <section className={`${cardClass} flex flex-wrap items-center gap-3`}>
          <Heart aria-hidden className="h-6 w-6 text-rose-600" />
          <p className="flex-1 text-sm">SOPBox is free for small stores. If it helps your business, you can support it with a donation.</p>
          <a href={pricing.kofi_url} target="_blank" rel="noopener noreferrer" className={secondaryButton}>
            Donate on Ko-fi
          </a>
        </section>
      )}
    </main>
  );
}
