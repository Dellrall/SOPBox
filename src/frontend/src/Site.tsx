import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ChevronDown, ClipboardCheck, Menu, Smartphone } from "lucide-react";
import type { PublicPath } from "./App";
import { SdgFooter } from "./Sdg";

type Navigate = (to: PublicPath) => void;

// Light green on deep green: dark text keeps it readable (contrast above 4.5:1).
const headerButton = "inline-flex h-10 items-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition sm:px-4";

export const ctaButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-leaf px-6 py-3 text-base font-semibold text-brand-950 shadow-sm transition hover:bg-[#8cc93e] active:scale-[0.98]";

/**
 * The title and description for this page, also when moving between pages without a reload.
 * The server sends the same ones in the first response (app/seo.py), which is what search engines read.
 */
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  }, [title, description]);
}

/** Real links (crawlable, open in a new tab) that switch pages without a reload. */
export function linkTo(navigate: Navigate | undefined, to: PublicPath) {
  return {
    href: to,
    onClick: (e: MouseEvent) => {
      if (!navigate || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
    },
  };
}

const SECTIONS = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/#sdgs", label: "SDGs" },
];
const PAGES: { to: PublicPath; label: string }[] = [
  { to: "/pricing", label: "Pricing" },
  { to: "/contact", label: "Contact" },
  { to: "/privacy", label: "Privacy" },
];

/** Every page and section of the public site, from one button at the side of the header. */
function SiteMenu({ navigate }: { navigate: Navigate }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => box.current?.contains(e.target as Node) || setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const item = "block rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-brand-50";
  const page = (to: PublicPath) => {
    const link = linkTo(navigate, to);
    return { ...link, onClick: (e: MouseEvent) => (setOpen(false), link.onClick(e)) };
  };
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label="Menu"
        onClick={() => setOpen(!open)}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-white ring-1 ring-white/25 hover:bg-white/10 sm:px-3"
      >
        <Menu aria-hidden className="h-5 w-5 sm:h-4 sm:w-4" />
        <span aria-hidden className="hidden sm:inline">
          Menu
        </span>
        <ChevronDown aria-hidden className={`hidden h-4 w-4 transition sm:block ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <nav
          id="site-menu"
          aria-label="Site menu"
          className="absolute right-0 top-full z-40 mt-2 w-64 rounded-2xl border border-line bg-white p-2 shadow-xl shadow-brand-950/20"
        >
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">SOPBox</p>
          <a {...page("/")} className={item}>
            Home
          </a>
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href} onClick={() => setOpen(false)} className={item}>
              {s.label}
            </a>
          ))}
          {PAGES.map((p) => (
            <a key={p.to} {...page(p.to)} className={item}>
              {p.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

/**
 * The public pages' header, in two rows like many product sites: a thin bar with a short note and the
 * secondary links, then the logo, the main links, sign in and one sign-up button. Phones get the menu instead.
 */
export function SiteHeader({ navigate, signedIn = false }: { navigate: Navigate; signedIn?: boolean }) {
  const small = "text-xs font-medium uppercase tracking-wider text-white/65 hover:text-white";
  const main = "rounded-lg px-3 py-2 text-sm font-medium text-white/80 hover:text-white";
  return (
    <header className="relative z-30">
      <div className="border-b border-white/10 bg-black/25">
        <div className="mx-auto flex h-9 max-w-6xl items-center gap-6 px-5 sm:px-8">
          <p className="truncate text-xs text-white/75">
            Free for one store, no card needed.{" "}
            <a {...linkTo(navigate, "/pricing")} className="font-semibold text-leaf underline-offset-4 hover:underline">
              See pricing &rarr;
            </a>
          </p>
          <nav aria-label="More" className="ml-auto hidden items-center gap-6 md:flex">
            <a {...linkTo(navigate, "/contact?topic=sales")} className={small}>
              Contact sales
            </a>
            <a {...linkTo(navigate, "/contact")} className={small}>
              Help
            </a>
            <a {...linkTo(navigate, "/privacy")} className={small}>
              Privacy
            </a>
          </nav>
        </div>
      </div>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4 sm:px-8">
        <a {...linkTo(navigate, "/")} className="flex items-center gap-3">
          <img src="/logo-128.webp" alt="" width={40} height={40} className="h-10 w-10 rounded-xl ring-2 ring-white/15" />
          <span className="hidden text-lg font-bold text-white min-[400px]:inline">SOPBox</span>
        </a>
        <nav aria-label="Site" className="ml-8 hidden items-center gap-1 lg:flex">
          {SECTIONS.slice(0, 2).map((s) => (
            <a key={s.href} href={s.href} className={main}>
              {s.label}
            </a>
          ))}
          <a {...linkTo(navigate, "/pricing")} className={main}>
            Pricing
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-4">
          {signedIn ? (
            <a href="/" className={`${headerButton} bg-leaf text-brand-950 hover:bg-[#8cc93e]`}>
              Open SOPBox
            </a>
          ) : (
            <>
              <a {...linkTo(navigate, "/signin")} className="whitespace-nowrap px-1 text-sm font-semibold text-white/90 hover:text-white">
                Sign in
              </a>
              <a {...linkTo(navigate, "/register")} className={`${headerButton} bg-leaf text-brand-950 shadow-sm hover:bg-[#8cc93e]`}>
                Sign up<span className="hidden sm:inline">&nbsp;free</span>
              </a>
            </>
          )}
          <div className="lg:hidden">
            <SiteMenu navigate={navigate} />
          </div>
        </div>
      </div>
    </header>
  );
}

/** The public pages' footer: every page, how to reach sales, and the SDGs. */
export function SiteFooter({ navigate }: { navigate: Navigate }) {
  const heading = "mb-2 text-xs font-semibold uppercase tracking-wider text-ink";
  const link = "block py-1 text-muted hover:text-brand-700";
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 text-sm sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-semibold text-brand-950">
            <ClipboardCheck aria-hidden className="h-4 w-4 text-brand-600" /> SOPBox
          </p>
          <p className="text-muted">Smart receiving checks for food and beverage businesses.</p>
          <p className="flex items-center gap-2 text-muted">
            <Smartphone aria-hidden className="h-4 w-4" /> Works in any phone browser
          </p>
        </div>
        <nav aria-label="Product">
          <p className={heading}>Product</p>
          {SECTIONS.slice(0, 2).map((s) => (
            <a key={s.href} href={s.href} className={link}>
              {s.label}
            </a>
          ))}
          <a {...linkTo(navigate, "/pricing")} className={link}>
            Pricing
          </a>
        </nav>
        <nav aria-label="Company">
          <p className={heading}>Company</p>
          <a {...linkTo(navigate, "/privacy")} className={link}>
            Privacy
          </a>
          <a {...linkTo(navigate, "/contact")} className={link}>
            Contact us
          </a>
          <a {...linkTo(navigate, "/contact?topic=sales")} className={link}>
            Talk to sales
          </a>
        </nav>
        <nav aria-label="Account">
          <p className={heading}>Account</p>
          <a {...linkTo(navigate, "/signin")} className={link}>
            Sign in
          </a>
          <a {...linkTo(navigate, "/register")} className={link}>
            Create a workspace
          </a>
        </nav>
      </div>
      <div className="mx-auto max-w-6xl border-t border-line px-5 py-5 sm:px-8">
        <SdgFooter />
      </div>
    </footer>
  );
}

/** Pricing and privacy for pages outside the public site: sign in, and the app itself. */
export function PolicyLinks({ className = "" }: { className?: string }) {
  return (
    <p className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted print:hidden ${className}`}>
      {PAGES.map((p) => (
        <a key={p.to} href={p.to} className="hover:text-brand-700 hover:underline">
          {p.label}
        </a>
      ))}
    </p>
  );
}
