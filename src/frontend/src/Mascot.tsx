import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { MessageCircle, X } from "lucide-react";
import type { PageId } from "./App";

/**
 * The cabbage, carrot and fish from the logo, keeping the user company: whichever page is open
 * says what is going on (who is on it, what they are doing, how far along), and the dock in the
 * corner acts it out. Pages call useMascot with a scene built from their own state, so the scene
 * follows progress on every render.
 */

export type Who = "cabbage" | "carrot" | "fish" | "crew";
/** "type", "pet" and "sad" are the dock's own reactions (typing, being clicked, an error on screen); pages use the rest. */
export type Action = "wave" | "read" | "probe" | "carry" | "count" | "write" | "cheer" | "worry" | "sleep" | "type" | "pet" | "sad" | "walk";
/** `to` marks an alert: left-clicking the helper opens that page. */
export type Scene = { who: Who; action: Action; text?: string; progress?: number; to?: PageId };

let current: Scene | null = null;
const listeners = new Set<() => void>();
const publish = (scene: Scene | null) => {
  current = scene;
  listeners.forEach((l) => l());
};

// Error messages on screen right now, newest last; while any is shown the helper is sad.
let errors: { id: number; text: string }[] = [];
let nextError = 0;
const publishErrors = (next: typeof errors) => {
  errors = next;
  listeners.forEach((l) => l());
};

/** Make the helper sad while this error message is on screen (empty = no error). */
export function useMascotSad(message: string) {
  useEffect(() => {
    if (!message) return;
    const id = ++nextError;
    publishErrors([...errors, { id, text: message }]);
    return () => publishErrors(errors.filter((e) => e.id !== id));
  }, [message]);
}

/** Show this scene while the calling component is on screen. */
export function useMascot(scene: Scene | null) {
  const key = scene ? `${scene.who}|${scene.action}|${scene.text ?? ""}|${scene.progress ?? ""}|${scene.to ?? ""}` : "";
  useEffect(() => {
    publish(scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => publish(null), []);
}

const INK = "#0b3d22";

/** Eyes and mouth for a mood, centred on (x, y). */
function Face({ x, y, action }: { x: number; y: number; action: Action }) {
  if (action === "sleep")
    return (
      <g stroke={INK} strokeWidth={2.5} strokeLinecap="round" fill="none">
        <path d={`M${x - 9} ${y} q3 3 6 0 M${x + 3} ${y} q3 3 6 0`} />
        <path d={`M${x - 3} ${y + 9} h6`} />
      </g>
    );
  const happy = action === "cheer" || action === "wave" || action === "type" || action === "pet";
  return (
    <g>
      {happy ? (
        <path d={`M${x - 9} ${y + 1} q3 -4 6 0 M${x + 3} ${y + 1} q3 -4 6 0`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" fill="none" />
      ) : (
        <>
          <circle cx={x - 6} cy={y} r={2.6} fill={INK} />
          <circle cx={x + 6} cy={y} r={2.6} fill={INK} />
        </>
      )}
      {action === "sad" ? (
        <>
          <path d={`M${x - 5} ${y + 11} q5 -5 10 0`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" fill="none" />
          <path className="mascot-tear" d={`M${x - 7} ${y + 4} q-2.5 4 0 6 q2.5 -2 0 -6z`} fill="#7cc6f0" stroke={INK} strokeWidth={1} />
          <path d={`M${x - 11} ${y - 6} l5 2 M${x + 11} ${y - 6} l-5 2`} stroke={INK} strokeWidth={2} strokeLinecap="round" />
        </>
      ) : action === "worry" ? (
        <>
          <path d={`M${x - 5} ${y + 11} q5 -4 10 0`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" fill="none" />
          <path d={`M${x + 14} ${y - 8} q-3 5 0 7 q3 -2 0 -7z`} fill="#7cc6f0" stroke={INK} strokeWidth={1.2} />
        </>
      ) : happy ? (
        <path d={`M${x - 6} ${y + 7} q6 7 12 0z`} fill="#c2410c" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      ) : (
        <path d={`M${x - 4} ${y + 8} q4 3 8 0`} stroke={INK} strokeWidth={2.5} strokeLinecap="round" fill="none" />
      )}
      <circle cx={x - 11} cy={y + 6} r={2.5} fill="#f9a8a8" opacity={0.7} />
      <circle cx={x + 11} cy={y + 6} r={2.5} fill="#f9a8a8" opacity={0.7} />
    </g>
  );
}

/** What the character holds, drawn to its right at hand height (hx, hy). */
function Prop({ action, hx, hy }: { action: Action; hx: number; hy: number }) {
  const s = { stroke: INK, strokeWidth: 2.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (action) {
    case "read": // magnifying glass
      return (
        <g className="mascot-scan" style={{ transformOrigin: `${hx}px ${hy}px` }}>
          <path d={`M${hx} ${hy} l9 -9`} {...s} strokeWidth={4} />
          <circle cx={hx + 15} cy={hy - 15} r={8} fill="#e0f2fe" {...s} />
        </g>
      );
    case "probe": // probe thermometer
      return (
        <g className="mascot-poke" style={{ transformOrigin: `${hx}px ${hy}px` }}>
          <rect x={hx - 3} y={hy - 14} width={9} height={14} rx={2} fill="#f8fafc" {...s} />
          <path d={`M${hx + 1.5} ${hy} v16`} {...s} strokeWidth={2} />
          <circle cx={hx + 1.5} cy={hy - 8} r={2} fill="#dc2626" />
        </g>
      );
    case "count": // clipboard
    case "write":
      return (
        <g>
          <rect x={hx - 2} y={hy - 20} width={20} height={25} rx={3} fill="#fef3c7" {...s} />
          <path d={`M${hx + 3} ${hy - 12} h10 M${hx + 3} ${hy - 6} h10 M${hx + 3} ${hy} h6`} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
          {action === "write" ? (
            <path className="mascot-scribble" d={`M${hx + 12} ${hy - 2} l9 -12`} stroke="#f59e0b" strokeWidth={4} strokeLinecap="round" />
          ) : (
            <path className="mascot-tick" d={`M${hx + 11} ${hy - 1} l3 3 l6 -7`} stroke="#059669" strokeWidth={2.5} strokeLinecap="round" fill="none" />
          )}
        </g>
      );
    case "carry": // a box held up
      return (
        <g className="mascot-lift">
          <path d={`M${hx - 4} ${hy - 22} h24 v18 h-24z`} fill="#e9b97a" {...s} />
          <path d={`M${hx - 4} ${hy - 16} h24`} stroke={INK} strokeWidth={1.6} />
        </g>
      );
    case "cheer": // sparkles
      return (
        <g className="mascot-zz" fill="#facc15" stroke={INK} strokeWidth={1.2}>
          <path d={`M${hx - 6} ${hy - 50} l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3z`} />
          <path d={`M${hx - 84} ${hy - 40} l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2z`} />
        </g>
      );
    case "pet": // hearts
      return (
        <g className="mascot-zz" fill="#f472b6" stroke={INK} strokeWidth={1.2}>
          <path d={`M${hx - 10} ${hy - 44} c-4 -6 -12 -2 -8 4 l8 7 l8 -7 c4 -6 -4 -10 -8 -4z`} />
          <path d={`M${hx - 76} ${hy - 50} c-3 -4 -8 -1 -5 3 l5 5 l5 -5 c3 -4 -2 -7 -5 -3z`} />
        </g>
      );
    case "sleep":
      return (
        <text x={hx + 2} y={hy - 18} className="mascot-zz" fontSize={13} fontWeight={800} fill={INK}>
          z
        </text>
      );
    default:
      return null;
  }
}

/** Arms: raised for cheer and wave, otherwise reaching to the prop. */
function Arms({ lx, rx, y, action, paw }: { lx: number; rx: number; y: number; action: Action; paw: number }) {
  const s = { stroke: INK, strokeWidth: 3, strokeLinecap: "round" as const, fill: "none" };
  if (action === "type")
    // Bongo-cat style: one paw slaps the desk per keystroke, alternating.
    return (
      <>
        <rect x={lx - 14} y={y + 14} width={rx - lx + 28} height={7} rx={3.5} fill="#cbd5e1" stroke={INK} strokeWidth={2.5} />
        {/* The raised paw lifts above the shoulder; the other one is down on the desk. */}
        <path d={`M${lx} ${y} L${lx - 7} ${paw ? y - 9 : y + 11} M${rx} ${y} L${rx + 7} ${paw ? y + 11 : y - 9}`} {...s} />
        <circle cx={lx - 7} cy={paw ? y - 9 : y + 11} r={4.5} fill="#fff" stroke={INK} strokeWidth={2.5} />
        <circle cx={rx + 7} cy={paw ? y + 11 : y - 9} r={4.5} fill="#fff" stroke={INK} strokeWidth={2.5} />
      </>
    );
  if (action === "cheer") return <path d={`M${lx} ${y} l-9 -12 M${rx} ${y} l9 -12`} {...s} />;
  if (action === "wave")
    return (
      <>
        <path d={`M${lx} ${y} l-7 8`} {...s} />
        <path className="mascot-wave" style={{ transformOrigin: `${rx}px ${y}px` }} d={`M${rx} ${y} l9 -11`} {...s} />
      </>
    );
  if (action === "sleep" || action === "worry" || action === "sad") return <path d={`M${lx} ${y} l-6 9 M${rx} ${y} l6 9`} {...s} />;
  return <path d={`M${lx} ${y} l-6 9 M${rx} ${y} l8 2`} {...s} />;
}

function Cabbage({ action, paw }: { action: Action; paw: number }) {
  return (
    <g>
      <path
        d="M30 95 C14 92 10 74 18 64 C8 54 16 36 30 38 C30 24 48 20 54 30 C64 20 82 28 78 42 C92 46 92 66 82 72 C88 86 76 98 62 95 Z"
        fill="#6fb33a"
        stroke={INK}
        strokeWidth={3.5}
        strokeLinejoin="round"
      />
      <path d="M50 92 C50 75 50 60 54 42 M50 78 C42 72 34 70 28 72 M51 66 C58 60 66 58 72 60" stroke="#f0f7e8" strokeWidth={3} strokeLinecap="round" fill="none" />
      <Face x={49} y={58} action={action} />
      <Arms lx={20} rx={82} y={72} action={action} paw={paw} />
      <Prop action={action} hx={88} hy={76} />
    </g>
  );
}

function Carrot({ action, paw }: { action: Action; paw: number }) {
  return (
    <g>
      <path d="M44 30 C40 18 42 10 47 8 M52 30 C54 16 60 10 64 12 M48 30 C46 22 50 14 56 18" stroke={INK} strokeWidth={9} strokeLinecap="round" fill="none" />
      <path d="M44 30 C40 18 42 10 47 8 M52 30 C54 16 60 10 64 12 M48 30 C46 22 50 14 56 18" stroke="#6fb33a" strokeWidth={4.5} strokeLinecap="round" fill="none" />
      <path d="M30 40 C30 30 68 28 70 40 C70 60 58 86 50 104 C46 106 44 104 42 98 C34 78 30 58 30 40 Z" fill="#f98f1d" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <path d="M36 70 h7 M55 80 h6 M40 88 h5" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
      <Face x={50} y={48} action={action} />
      <Arms lx={32} rx={68} y={62} action={action} paw={paw} />
      <Prop action={action} hx={74} hy={66} />
    </g>
  );
}

function Fish({ action, paw }: { action: Action; paw: number }) {
  return (
    <g>
      <path d="M78 66 L96 50 L94 84 Z" fill="#cfdcd5" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <path d="M12 66 C18 40 44 34 62 42 C72 46 78 56 80 66 C78 76 72 86 62 90 C44 98 18 92 12 66 Z" fill="#f2f6f3" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <path d="M44 58 C50 62 50 72 44 78" stroke="#b8c9bf" strokeWidth={3} strokeLinecap="round" fill="none" />
      <Face x={28} y={62} action={action} />
      <Arms lx={34} rx={56} y={86} action={action} paw={paw} />
      <Prop action={action} hx={60} hy={94} />
    </g>
  );
}

const BODY = { cabbage: Cabbage, carrot: Carrot, fish: Fish };
const MOTION: Record<Action, string> = {
  wave: "mascot-bob",
  read: "mascot-bob",
  probe: "mascot-bob",
  carry: "mascot-trudge",
  count: "mascot-bob",
  write: "mascot-bob",
  cheer: "mascot-hop",
  worry: "mascot-shiver",
  sleep: "mascot-breathe",
  type: "",
  pet: "mascot-squish",
  sad: "mascot-droop",
  walk: "mascot-run",
};

/** One character, or the whole crew side by side. No frame: it stands on the page. */
export function MascotFigure({ who, action, size = 72, paw = 0 }: { who: Who; action: Action; size?: number; paw?: number }) {
  const cast: Exclude<Who, "crew">[] = who === "crew" ? ["cabbage", "carrot", "fish"] : [who];
  return (
    <span style={{ display: "inline-flex", alignItems: "flex-end" }} aria-hidden>
      {cast.map((name, i) => {
        const Body = BODY[name];
        const scale = who === "crew" ? 0.72 : 1;
        return (
          <svg
            key={name}
            viewBox="0 0 110 112"
            width={size * scale}
            height={size * scale * (112 / 110)}
            className={MOTION[action]}
            style={{ animationDelay: `${i * 0.15}s`, marginLeft: i ? -size * 0.12 : 0 }}
            overflow="visible"
          >
            <Body action={action} paw={paw} />
          </svg>
        );
      })}
    </span>
  );
}

/** Narrow phones: the helper is smaller and its messages start folded away, so it covers less. */
const smallScreen = () => window.innerWidth < 400;

/** The person's own choice when they made one; otherwise folded away on small phones. */
function readTucked() {
  try {
    const saved = localStorage.getItem("sopbox-mascot-tucked");
    if (saved) return saved === "1";
  } catch {
    /* no saved choice */
  }
  return smallScreen();
}

const IDLE_MS = 20_000;
const LOOK_MS = 2600;

/** Where the helper is while it explores the page, in viewport pixels. */
type Roam = { x: number; y: number; facing: 1 | -1; action: Action; text: string; ms: number; home: boolean };

/** What the helper does when it stops on a part of the page. */
function perchOn(el: Element): Pick<Roam, "action" | "text"> {
  const tag = el.tagName;
  if (tag === "BUTTON") return { action: "wave", text: "Ooh, a button! I won't press it…" };
  if (/^H[1-3]$/.test(tag)) return { action: "read", text: "Reading the headlines…" };
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return { action: "write", text: "Doodling a little…" };
  if (tag === "IMG") return { action: "cheer", text: "What a nice kitchen!" };
  if (el.getAttribute("role") === "meter" || tag === "TABLE") return { action: "count", text: "Counting things…" };
  return { action: "sleep", text: "Just a short nap…" };
}

const PERCHES = "main h1, main h2, main h3, main button, main input, main select, main img, main [role=meter]";
const SIZE = 64;

/**
 * After a while with no mouse, touch, scroll or key, the helper looks around, says no one is
 * around, and wanders the page sitting on headings, buttons and pictures. Any activity sends it
 * running back home. It never clicks anything and never catches the pointer.
 */
function useRoam(home: React.RefObject<HTMLElement | null>) {
  const [roam, setRoam] = useState<Roam | null>(null);
  const roaming = useRef(false);
  const pos = useRef({ x: 0, y: 0 });
  const timer = useRef(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const homeSpot = () => {
      const r = home.current?.getBoundingClientRect();
      return r ? { x: r.right - SIZE, y: r.bottom - SIZE } : { x: window.innerWidth - SIZE - 16, y: window.innerHeight - SIZE - 16 };
    };
    const go = (next: Omit<Roam, "facing">) => {
      const facing: 1 | -1 = next.x < pos.current.x - 4 ? -1 : 1;
      pos.current = { x: next.x, y: next.y };
      setRoam({ ...next, facing });
    };
    const wander = () => {
      const spots = [...document.querySelectorAll(PERCHES)].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 40 && r.top > SIZE + 8 && r.top < window.innerHeight - 20 && r.left >= 0 && r.right <= window.innerWidth;
      });
      if (!spots.length) {
        timer.current = window.setTimeout(wander, 3000);
        return;
      }
      const el = spots[Math.floor(Math.random() * spots.length)];
      const r = el.getBoundingClientRect();
      const x = Math.max(4, Math.min(window.innerWidth - SIZE - 4, r.left + Math.random() * Math.max(0, r.width - SIZE)));
      const y = r.top - SIZE + 6; // sitting on the top edge
      const ms = Math.min(2600, Math.max(700, Math.hypot(x - pos.current.x, y - pos.current.y) * 3));
      go({ x, y, action: "walk", text: "", ms, home: false });
      timer.current = window.setTimeout(() => {
        go({ x, y, ...perchOn(el), ms: 0, home: false });
        timer.current = window.setTimeout(wander, 2500 + Math.random() * 2000);
      }, ms);
    };
    const start = () => {
      roaming.current = true;
      const spot = homeSpot();
      pos.current = spot;
      // Look one way, then the other, then set off.
      const look = (facing: 1 | -1) => setRoam({ ...spot, facing, action: "read", text: "Hmm… no one is around. I'm going to explore a bit!", ms: 0, home: true });
      look(-1);
      timer.current = window.setTimeout(() => {
        look(1);
        timer.current = window.setTimeout(() => {
          look(-1);
          timer.current = window.setTimeout(wander, LOOK_MS / 3);
        }, LOOK_MS / 3);
      }, LOOK_MS / 3);
    };
    const back = () => {
      clearTimeout(timer.current);
      if (roaming.current) {
        roaming.current = false;
        const spot = homeSpot();
        go({ ...spot, action: "walk", text: "Oh! You're back!", ms: 450, home: false });
        // Its own timer, so more activity during the dash home can't leave it stranded.
        window.setTimeout(() => setRoam(null), 500);
      }
      timer.current = window.setTimeout(start, IDLE_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, back, { capture: true, passive: true }));
    timer.current = window.setTimeout(start, IDLE_MS);
    return () => {
      events.forEach((e) => window.removeEventListener(e, back, { capture: true }));
      clearTimeout(timer.current);
    };
  }, [home]);

  return roam;
}

const PET_LINES = ["Hehe, that tickles!", "Purr… thank you!", "More please!", "You're the best boss!", "Aww ♥"];

/**
 * The corner dock: the current scene with a speech bubble and, when known, a progress bar.
 * Typing anywhere makes the helper drum along like Bongo Cat. Clicking it opens the page an alert
 * points to; right-clicking (long-press on touch) pets it.
 */
export function MascotDock({ fallback, go }: { fallback: Scene; go: (page: PageId) => void }) {
  const scene = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  ) ?? fallback;
  const error = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => errors[errors.length - 1]?.text ?? "",
  );
  const [tucked, setTucked] = useState(readTucked);
  const [paw, setPaw] = useState(0);
  const [typing, setTyping] = useState(false);
  const [petLine, setPetLine] = useState("");
  const typingTimer = useRef(0);
  const petTimer = useRef(0);
  const homeRef = useRef<HTMLButtonElement>(null);
  const roam = useRoam(homeRef);

  useEffect(() => {
    // `input` fires for every edit in any field, including phone keyboards that send no key codes.
    const onInput = () => {
      setPaw((p) => 1 - p);
      setTyping(true);
      clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => setTyping(false), 700);
    };
    document.addEventListener("input", onInput, true);
    return () => {
      document.removeEventListener("input", onInput, true);
      clearTimeout(typingTimer.current);
      clearTimeout(petTimer.current);
    };
  }, []);

  const pet = () => {
    setPetLine((last) => {
      const others = PET_LINES.filter((l) => l !== last);
      return others[Math.floor(Math.random() * others.length)];
    });
    clearTimeout(petTimer.current);
    petTimer.current = window.setTimeout(() => setPetLine(""), 1600);
  };
  const setTuck = (t: boolean) => {
    setTucked(t);
    try {
      localStorage.setItem("sopbox-mascot-tucked", t ? "1" : "0");
    } catch {
      /* the choice just won't be remembered */
    }
  };

  // Petting and typing cheer it up for a moment; otherwise an error on screen makes it sad.
  const action: Action = petLine ? "pet" : typing ? "type" : error ? "sad" : scene.action;
  const text = petLine || (tucked ? "" : error ? `Oh no… ${error}` : scene.text);
  // An error on screen takes over the bubble, so the alert's link waits until it is gone.
  const target = error ? undefined : scene.to;

  let bubble: ReactNode = null;
  if (text)
    bubble = (
      <div className="mascot-pop pointer-events-auto relative mb-10 max-w-52 rounded-2xl rounded-br-sm bg-white py-2 pl-3 pr-7 text-xs font-medium text-ink shadow-lg ring-1 ring-line sm:max-w-60 sm:text-sm">
        <p aria-live="polite" className="line-clamp-4">{text}</p>
        {!petLine && !error && scene.progress !== undefined && (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-600 transition-all duration-500" style={{ width: `${Math.round(Math.min(1, Math.max(0, scene.progress)) * 100)}%` }} />
          </div>
        )}
        {!petLine && (
          <button
            type="button"
            onClick={() => setTuck(true)}
            className="absolute right-1 top-1 rounded-full p-1 text-muted hover:bg-slate-100 hover:text-ink"
            aria-label="Hide the helper's messages"
            title="Hide messages"
          >
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );

  return (
    <>
    {roam && (
      // The explorer: decorative only, never catches the pointer.
      <div
        aria-hidden
        data-mascot-roam
        className="pointer-events-none fixed left-0 top-0 z-30 print:hidden"
        style={{
          transform: `translate(${roam.x}px, ${roam.y}px)`,
          transition: roam.ms ? `transform ${roam.ms}ms cubic-bezier(.45,.05,.35,1)` : "none",
        }}
      >
        {roam.text && (
          <div className="mascot-pop absolute bottom-full right-0 mb-1 w-max max-w-56 rounded-2xl bg-white px-3 py-1.5 text-xs font-medium text-ink shadow-lg ring-1 ring-line">
            {roam.text}
          </div>
        )}
        <div style={{ transform: `scaleX(${roam.facing})`, transition: "transform 150ms" }}>
          <MascotFigure who={scene.who === "crew" ? "cabbage" : scene.who} action={roam.action} size={SIZE} />
        </div>
      </div>
    )}
    <div className="pointer-events-none fixed bottom-2 right-2 z-20 flex items-end gap-1 print:hidden sm:bottom-4 sm:right-4">
      {!roam && bubble}
      {tucked && !petLine && (scene.text || error) && (
        <button
          type="button"
          onClick={() => setTuck(false)}
          className="pointer-events-auto mb-1 rounded-full bg-white p-1.5 text-brand-700 shadow ring-1 ring-line hover:bg-brand-50"
          aria-label="Show the helper's messages"
          title="Show messages"
        >
          <MessageCircle aria-hidden className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => target && go(target)}
        onContextMenu={(e) => {
          e.preventDefault();
          pet();
        }}
        ref={homeRef}
        className={`pointer-events-auto rounded-full ${target ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} ${roam ? "invisible" : ""} focus-visible:outline-2 focus-visible:outline-brand-600`}
        aria-label={target ? "Open what the helper is pointing at" : "The helper (right-click to pet)"}
        title={target ? "Click to go there · right-click to pet me" : "Right-click to pet me!"}
      >
        <MascotFigure who={scene.who} action={action} paw={paw} size={tucked || smallScreen() ? 48 : 64} />
      </button>
    </div>
    </>
  );
}
