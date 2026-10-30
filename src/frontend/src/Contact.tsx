import { useEffect, useState, type FormEvent } from "react";
import { Briefcase, Clock, Mail, MessageCircleQuestion, Phone, ShieldCheck } from "lucide-react";
import { api } from "./api";
import type { PublicPath } from "./App";
import { MascotFigure } from "./Mascot";
import { SiteFooter, SiteHeader, linkTo, usePageMeta } from "./Site";
import type { Pricing } from "./types";
import { ErrorNote, SuccessNote, inputClass, labelClass, primaryButton } from "./ui";

type Topic = "question" | "sales";

const TOPICS: { id: Topic; icon: typeof Briefcase; title: string; text: string }[] = [
  { id: "question", icon: MessageCircleQuestion, title: "Ask a question", text: "About SOPBox, your account or how something works." },
  { id: "sales", icon: Briefcase, title: "Talk to sales", text: "More outlets, a group or franchise, or an Enterprise plan." },
];

/** The public contact page: a question for the team, or a sales enquiry. Both reach the team's inbox (inquiries.py). */
export default function Contact({ navigate, signedIn }: { navigate: (to: PublicPath) => void; signedIn: boolean }) {
  usePageMeta(
    "Contact · SOPBox",
    "Ask the SOPBox team a question or talk to sales about plans for more outlets and groups. Leave your details and we will get back to you.",
  );
  const [topic, setTopic] = useState<Topic>(() =>
    new URLSearchParams(window.location.search).get("topic") === "sales" ? "sales" : "question",
  );
  const [form, setForm] = useState({ name: "", company: "", email: "", phone: "", outlets: "", message: "" });
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const sales = topic === "sales";

  useEffect(() => {
    api
      .pricing()
      .then(setPricing)
      .catch(() => undefined);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.salesInquiry({
        topic,
        ...form,
        company: sales ? form.company : "",
        phone: sales ? form.phone : "",
        outlets: sales && form.outlets ? Number(form.outlets) : null,
      });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof form, label: string, type: string, autoComplete: string, required = false) => (
    <div>
      <label className={labelClass} htmlFor={`contact-${key}`}>
        {label}
        {!required && <span className="font-normal text-muted"> (optional)</span>}
      </label>
      <input
        id={`contact-${key}`}
        type={type}
        required={required}
        min={type === "number" ? 1 : undefined}
        maxLength={type === "number" ? undefined : key === "phone" ? 40 : key === "name" || key === "company" ? 120 : 254}
        autoComplete={autoComplete}
        className={inputClass}
        value={form[key]}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-surface text-ink">
      <div className="hero-pattern pb-24 text-white sm:pb-28">
        <SiteHeader navigate={navigate} signedIn={signedIn} />
        <div className="mx-auto max-w-3xl px-5 pt-2 text-center sm:px-8 sm:pt-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-leaf">Contact</p>
          <h1 className="mt-2 text-3xl font-extrabold leading-tight sm:mt-3 sm:text-5xl">How can we help?</h1>
          <p className="mx-auto mt-3 max-w-xl text-white/75 sm:mt-4 sm:text-lg">
            Ask a question or talk to sales. Leave your details and we will get back to you.
          </p>
        </div>
      </div>

      <main id="main" className="mx-auto -mt-20 grid max-w-6xl gap-6 px-5 pb-16 sm:px-8 lg:grid-cols-[1fr_1.6fr]">
        <aside className="order-2 space-y-4 lg:order-1">
          <div className="rounded-3xl bg-white p-6 ring-1 ring-line">
            <h2 className="font-semibold">Other ways to reach us</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {pricing?.sales_email && (
                <li className="flex items-center gap-3">
                  <Mail aria-hidden className="h-5 w-5 text-brand-600" />
                  <a className="font-semibold text-brand-700 underline" href={`mailto:${pricing.sales_email}`}>
                    {pricing.sales_email}
                  </a>
                </li>
              )}
              {pricing?.sales_phone && (
                <li className="flex items-center gap-3">
                  <Phone aria-hidden className="h-5 w-5 text-brand-600" />
                  <a className="font-semibold text-brand-700 underline" href={`tel:${pricing.sales_phone.replace(/\s/g, "")}`}>
                    {pricing.sales_phone}
                  </a>
                </li>
              )}
              <li className="flex gap-3 text-muted">
                <Clock aria-hidden className="h-5 w-5 shrink-0 text-brand-600" />
                We reply by email. Workspaces with priority support are answered first.
              </li>
              <li className="flex gap-3 text-muted">
                <ShieldCheck aria-hidden className="h-5 w-5 shrink-0 text-brand-600" />
                <span>
                  We use your details only to reply. See our{" "}
                  <a {...linkTo(navigate, "/privacy")} className="font-semibold text-brand-700 underline">
                    privacy notice
                  </a>
                  .
                </span>
              </li>
            </ul>
          </div>
          {signedIn ? (
            <p className="rounded-3xl bg-brand-50 p-6 text-sm text-brand-950 ring-1 ring-brand-100">
              <strong className="block">Already using SOPBox?</strong>
              Ask for help from Settings in the app, and we will see your workspace and plan straight away.
            </p>
          ) : (
            <p className="rounded-3xl bg-brand-50 p-6 text-sm text-brand-950 ring-1 ring-brand-100">
              <strong className="block">Want to see prices first?</strong>
              <a {...linkTo(navigate, "/pricing")} className="font-semibold underline">
                Compare plans
              </a>{" "}
              or{" "}
              <a {...linkTo(navigate, "/register")} className="font-semibold underline">
                start free
              </a>
              .
            </p>
          )}
        </aside>

        <section
          aria-labelledby="contact-form"
          className="order-1 rounded-3xl bg-white p-6 shadow-lg shadow-brand-900/10 ring-1 ring-line sm:p-8 lg:order-2"
        >
          <div className="flex items-end justify-between gap-4">
            <h2 id="contact-form" className="text-2xl font-bold">
              Send us a message
            </h2>
            <MascotFigure who={sent ? "cabbage" : "carrot"} action={sent ? "cheer" : "write"} size={60} />
          </div>
          {sent ? (
            <div className="mt-6">
              <SuccessNote>
                Thank you. {sales ? "Our sales team" : "The SOPBox team"} will reply to {form.email} soon.
              </SuccessNote>
            </div>
          ) : (
            <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-5">
              <fieldset>
                <legend className={labelClass}>What is it about?</legend>
                <div className="mt-1 grid gap-3 sm:grid-cols-2">
                  {TOPICS.map((t) => {
                    const Icon = t.icon;
                    const on = topic === t.id;
                    return (
                      <label
                        key={t.id}
                        className={`flex cursor-pointer gap-3 rounded-2xl p-4 ring-1 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600 ${on ? "bg-brand-50 ring-2 ring-brand-600" : "ring-line hover:ring-slate-400"}`}
                      >
                        <input type="radio" name="topic" value={t.id} checked={on} onChange={() => setTopic(t.id)} className="sr-only" />
                        <Icon aria-hidden className={`h-6 w-6 shrink-0 ${on ? "text-brand-600" : "text-muted"}`} />
                        <span>
                          <span className="block font-semibold">{t.title}</span>
                          <span className="block text-sm text-muted">{t.text}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                {field("name", "Your name", "text", "name", true)}
                {field("email", "Email", "email", "email", true)}
                {sales && field("company", "Business name", "text", "organization")}
                {sales && field("phone", "Phone", "tel", "tel")}
                {sales && field("outlets", "Number of outlets", "number", "off")}
              </div>
              <div>
                <label className={labelClass} htmlFor="contact-message">
                  {sales ? "What do you need?" : "Your question"}
                  {sales && <span className="font-normal text-muted"> (optional)</span>}
                </label>
                <textarea
                  id="contact-message"
                  rows={5}
                  required={!sales}
                  maxLength={4000}
                  className={inputClass}
                  value={form.message}
                  onChange={(e) => set({ message: e.target.value })}
                />
              </div>
              <ErrorNote message={error} />
              <button type="submit" disabled={busy} className={`${primaryButton} w-full py-3 text-base sm:w-auto`}>
                {busy ? "Sending…" : sales ? "Send to sales" : "Send question"}
              </button>
            </form>
          )}
        </section>
      </main>
      <SiteFooter navigate={navigate} />
    </div>
  );
}
