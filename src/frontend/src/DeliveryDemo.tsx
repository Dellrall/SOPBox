import { useEffect, useState } from "react";
import { BellRing, Camera, Check, ClipboardCheck, Thermometer, X } from "lucide-react";

/**
 * A scripted walkthrough of one delivery, for the welcome page. Static data: nothing here talks
 * to the server. It plays by itself unless the visitor prefers reduced motion, and pauses while
 * the pointer or keyboard focus is on it.
 */

const STEPS = [
  { id: "photo", icon: Camera, label: "Photo", title: "Staff photograph the delivery order" },
  { id: "read", icon: ClipboardCheck, label: "AI reads", title: "The AI fills in the lines to confirm" },
  { id: "check", icon: Thermometer, label: "Rules check", title: "Rules check temperature, packs and quantity" },
  { id: "decide", icon: BellRing, label: "Manager decides", title: "A manager decides, and everyone is told" },
] as const;

const LINES = [
  { name: "Frozen Sausage 1kg", qty: "10 pkt", temp: "−5 °C" },
  { name: "Chocolate Balls", qty: "2 box", temp: "−18 °C" },
  { name: "Fries Tray", qty: "2 bdl", temp: "−16 °C" },
  { name: "Coke 330ml", qty: "3 ctn", temp: "4 °C" },
];

const CHECKS = [
  { name: "Frozen sausage", ok: false, note: "−5 °C is outside −20 to −10 °C" },
  { name: "Chocolate balls", ok: true, note: "Temperature and quantity match" },
  { name: "Fries tray", ok: false, note: "2 bdl = 500 pcs, but 600 were ordered" },
  { name: "Coke", ok: true, note: "Quantity matches the order" },
];

const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function Screen({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700 shadow-sm">
          <p className="font-bold text-slate-900">DELIVERY ORDER DO-10234</p>
          <p className="text-slate-500">Fresh Mart Sdn Bhd · 23/10/2026</p>
          <div className="mt-2 border-t border-slate-200 pt-2">
            {LINES.map((l) => (
              <p key={l.name} className="flex justify-between">
                <span>{l.name}</span>
                <span>{l.qty}</span>
              </p>
            ))}
          </div>
          <span aria-hidden className="demo-scan absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-transparent via-leaf/40 to-transparent" />
        </div>
        <div className="flex items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-xs font-semibold text-white">
          <Camera aria-hidden className="h-4 w-4" /> Photograph the order
        </div>
      </div>
    );
  }
  if (step === 1) {
    return (
      <ul className="space-y-2">
        {LINES.map((l, i) => (
          <li key={l.name} className="demo-rise rounded-xl border border-slate-200 bg-white p-2.5 text-xs shadow-sm" style={{ animationDelay: `${i * 120}ms` }}>
            <p className="font-semibold text-slate-900">{l.name}</p>
            <p className="mt-0.5 flex justify-between text-slate-500">
              <span>{l.qty}</span>
              <span>Probe: {l.temp}</span>
            </p>
          </li>
        ))}
      </ul>
    );
  }
  if (step === 2) {
    return (
      <ul className="space-y-2">
        {CHECKS.map((c, i) => (
          <li
            key={c.name}
            className={`demo-rise flex gap-2 rounded-xl border p-2.5 text-xs ${c.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}
            style={{ animationDelay: `${i * 120}ms` }}
          >
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${c.ok ? "bg-emerald-500" : "bg-red-500"}`}>
              {c.ok ? <Check aria-hidden className="h-3 w-3 text-white" /> : <X aria-hidden className="h-3 w-3 text-white" />}
            </span>
            <span>
              <span className="block font-semibold text-slate-900">
                {c.name} <span className="sr-only">{c.ok ? "passes" : "fails"}</span>
              </span>
              <span className={c.ok ? "text-emerald-800" : "text-red-800"}>{c.note}</span>
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="space-y-3">
      <div className="demo-rise rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm">
        <p className="font-semibold text-slate-900">Delivery #42 · 2 lines failed</p>
        <p className="mt-1 text-slate-500">Reason</p>
        <p className="mt-0.5 rounded-lg border border-slate-200 px-2 py-1.5 text-slate-800">Sausage thawed on arrival</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center font-semibold">
          <span className="rounded-lg border border-slate-200 py-1.5 text-slate-600">Accept</span>
          <span className="rounded-lg border border-slate-200 py-1.5 text-slate-600">Return</span>
          <span className="rounded-lg bg-red-600 py-1.5 text-white ring-2 ring-red-300">Reject</span>
        </div>
      </div>
      <div className="demo-rise rounded-2xl rounded-tl-sm bg-[#e7f3fe] p-3 text-xs text-slate-800 shadow-sm" style={{ animationDelay: "350ms" }}>
        <p className="font-semibold text-sky-700">SOPBox bot · Telegram</p>
        <p className="mt-1">Delivery #42 from Fresh Mart was rejected by Mia (manager): Sausage thawed on arrival.</p>
      </div>
      <p className="demo-rise text-center text-[11px] text-slate-500" style={{ animationDelay: "600ms" }}>
        Saved to the audit log with who, when and every reading.
      </p>
    </div>
  );
}

export default function DeliveryDemo() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [autoplay] = useState(() => !prefersReducedMotion());

  useEffect(() => {
    if (!autoplay || paused) return;
    const timer = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), 3800);
    return () => window.clearTimeout(timer);
  }, [step, paused, autoplay]);

  const current = STEPS[step];
  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="mx-auto w-full max-w-sm"
    >
      <div className="rounded-[2.2rem] bg-brand-950 p-2.5 shadow-2xl shadow-brand-950/40 ring-1 ring-white/10">
        <div className="overflow-hidden rounded-[1.8rem] bg-surface">
          <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-3">
            <img src="/logo-128.webp" alt="" width={24} height={24} className="h-6 w-6 rounded-md" />
            <span className="text-xs font-bold text-brand-950">SOPBox · Receiving check</span>
            <span className="ml-auto text-[10px] font-semibold text-muted">
              {step + 1}/{STEPS.length}
            </span>
          </div>
          <div className="px-4 pt-3">
            <p className="text-sm font-bold text-brand-950" aria-live="polite">
              {current.title}
            </p>
          </div>
          <div key={step} className="h-[19rem] px-4 py-3">
            <Screen step={step} />
          </div>
        </div>
      </div>

      <div role="tablist" aria-label="Walkthrough steps" className="mt-5 grid grid-cols-4 gap-1.5">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = i === step;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={active}
              onClick={() => setStep(i)}
              className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition ${
                active ? "bg-white text-brand-950 shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
