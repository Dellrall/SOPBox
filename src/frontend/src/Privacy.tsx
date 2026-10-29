import type { ReactNode } from "react";
import type { PublicPath } from "./App";
import { SiteFooter, SiteHeader, linkTo, usePageMeta } from "./Site";

const UPDATED = "29 October 2026";

type Section = { id: string; title: string; body: ReactNode };

/**
 * What SOPBox does with personal data. Keep every sentence true to the code: when a feature changes
 * what is collected, shared or kept, change this page in the same pull request.
 */
export default function Privacy({ navigate, signedIn }: { navigate: (to: PublicPath) => void; signedIn: boolean }) {
  usePageMeta(
    "Privacy · SOPBox",
    "How SOPBox collects, uses, shares and protects personal data, how long it is kept, and how to download or delete it, in line with Malaysia's Personal Data Protection Act.",
  );
  const contact = (
    <a {...linkTo(navigate, "/contact")} className="font-semibold text-brand-700 underline">
      contact page
    </a>
  );

  const sections: Section[] = [
    {
      id: "who",
      title: "Who we are",
      body: (
        <>
          <p>
            SOPBox is a receiving-check app for food and beverage businesses. This notice explains how we handle personal data, in line with
            Malaysia&apos;s Personal Data Protection Act 2010.
          </p>
          <p>
            Each business that uses SOPBox decides what its team records, such as deliveries, comments and photos; we handle that data on
            the business&apos;s behalf. For accounts, sign-ins and messages sent to us, SOPBox itself is responsible.
          </p>
        </>
      ),
    },
    {
      id: "collect",
      title: "What we collect",
      body: (
        <ul>
          <li>
            <strong>Your account:</strong> username, display name, an optional email address, your role, and how you sign in. Passwords are
            stored only as a one-way hash; two-step sign-in secrets are encrypted, and backup codes are hashed.
          </li>
          <li>
            <strong>Sign-ins:</strong> when you signed in, the method, and a short description of the device and browser, so you can spot a
            sign-in you did not make.
          </li>
          <li>
            <strong>Your business&apos;s records:</strong> products, suppliers, deliveries, delivery-order and stock photos, readings,
            approvals, comments, stock counts, sales and the activity log of who did what.
          </li>
          <li>
            <strong>Messages to us:</strong> what you send from the contact page or Settings, such as your name, business, email and phone.
          </li>
        </ul>
      ),
    },
    {
      id: "use",
      title: "How we use it",
      body: (
        <>
          <p>
            To run SOPBox for your business: checking deliveries, alerting the right people, keeping the activity log, and securing
            accounts. To reply when you contact us.
          </p>
          <p>We do not sell personal data, show advertising, or use your records to train AI models.</p>
        </>
      ),
    },
    {
      id: "share",
      title: "Who else handles it",
      body: (
        <ul>
          <li>
            <strong>Replit</strong> hosts the app and its database.
          </li>
          <li>
            <strong>RunPod</strong> runs the AI model that reads delivery-order photos. Photos are sent there only to be read, on our own
            endpoint with an open model; they are not used for training.
          </li>
          <li>
            <strong>Telegram</strong> carries alerts, only if your business connects a Telegram chat.
          </li>
          <li>
            <strong>Google</strong> confirms who you are, only if you choose to sign in with Google.
          </li>
          <li>
            <strong>Ko-fi</strong> handles donations on its own site, under its own privacy policy.
          </li>
        </ul>
      ),
    },
    {
      id: "cookies",
      title: "Cookies and storage",
      body: (
        <p>
          One cookie keeps you signed in; SOPBox cannot work without it. Your browser also remembers a few display choices on your device.
          There are no advertising or tracking cookies and no analytics.
        </p>
      ),
    },
    {
      id: "security",
      title: "How we protect it",
      body: (
        <p>
          Every connection is encrypted (HTTPS). Each business&apos;s data is kept apart inside the database, so one business cannot see
          another&apos;s. Owners can require two-step sign-in, risky actions ask for a fresh code and alert the owner, and repeated attempts
          are slowed down. If a breach puts your data at risk, we will tell the affected businesses and the authorities as the law requires.
        </p>
      ),
    },
    {
      id: "keep",
      title: "How long we keep it",
      body: (
        <p>
          While the business&apos;s workspace is open. When its owner closes the business, it becomes read-only for 30 days, so everyone can
          still download their data, and is then deleted for good. We keep only a short note that it existed: its number, name, and when and
          by whom it was closed.
        </p>
      ),
    },
    {
      id: "rights",
      title: "Your rights",
      body: (
        <ul>
          <li>
            <strong>See and download:</strong> the owner, and anyone the owner allows, can download a copy from Settings.
          </li>
          <li>
            <strong>Correct:</strong> change your name, username and email in Settings at any time.
          </li>
          <li>
            <strong>Delete:</strong> ask your business&apos;s owner to remove your account, or the owner can close the business.
          </li>
          <li>
            <strong>Ask or complain:</strong> use the {contact}. You can also complain to Malaysia&apos;s Personal Data Protection
            Commissioner.
          </li>
        </ul>
      ),
    },
    {
      id: "changes",
      title: "Changes to this notice",
      body: <p>When we change how we handle data, we update this page and the date at the top.</p>,
    },
  ];

  return (
    <div className="min-h-screen bg-surface text-ink">
      <div className="hero-pattern pb-28 text-white">
        <SiteHeader navigate={navigate} signedIn={signedIn} />
        <div className="mx-auto max-w-3xl px-5 pt-8 text-center sm:px-8">
          <p className="text-sm font-semibold uppercase tracking-wider text-leaf">Privacy</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight sm:text-5xl">Your data stays yours</h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-white/75">
            What SOPBox collects, why, who else handles it, and the choices you have.
          </p>
          <p className="mt-4 text-sm text-white/60">Last updated {UPDATED}</p>
        </div>
      </div>

      <main id="main" className="mx-auto -mt-20 grid max-w-6xl gap-6 px-5 pb-16 sm:px-8 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="On this page" className="hidden self-start rounded-3xl bg-white p-5 ring-1 ring-line lg:sticky lg:top-6 lg:block">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">On this page</p>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="block rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-brand-50 hover:text-brand-700"
            >
              {s.title}
            </a>
          ))}
        </nav>
        <article className="space-y-10 rounded-3xl bg-white p-6 shadow-lg shadow-brand-900/10 ring-1 ring-line sm:p-10">
          {sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-6">
              <h2 id={`${s.id}-title`} className="text-xl font-bold">
                {s.title}
              </h2>
              <div className="mt-3 space-y-3 leading-relaxed text-slate-700 [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
                {s.body}
              </div>
            </section>
          ))}
        </article>
      </main>
      <SiteFooter navigate={navigate} />
    </div>
  );
}
