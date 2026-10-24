import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * The cabbage, carrot and fish from the logo, keeping the user company: whichever page is open
 * says what is going on (who is on it, what they are doing, how far along), and the dock in the
 * corner acts it out. Pages call useMascot with a scene built from their own state, so the scene
 * follows progress on every render.
 */

export type Who = "cabbage" | "carrot" | "fish" | "crew";
export type Action = "wave" | "read" | "probe" | "carry" | "count" | "write" | "cheer" | "worry" | "sleep";
export type Scene = { who: Who; action: Action; text?: string; progress?: number };

let current: Scene | null = null;
const listeners = new Set<() => void>();
const publish = (scene: Scene | null) => {
  current = scene;
  listeners.forEach((l) => l());
};

/** Show this scene while the calling component is on screen. */
export function useMascot(scene: Scene | null) {
  const key = scene ? `${scene.who}|${scene.action}|${scene.text ?? ""}|${scene.progress ?? ""}` : "";
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
  const happy = action === "cheer" || action === "wave";
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
      {action === "worry" ? (
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
function Arms({ lx, rx, y, action }: { lx: number; rx: number; y: number; action: Action }) {
  const s = { stroke: INK, strokeWidth: 3, strokeLinecap: "round" as const, fill: "none" };
  if (action === "cheer") return <path d={`M${lx} ${y} l-9 -12 M${rx} ${y} l9 -12`} {...s} />;
  if (action === "wave")
    return (
      <>
        <path d={`M${lx} ${y} l-7 8`} {...s} />
        <path className="mascot-wave" style={{ transformOrigin: `${rx}px ${y}px` }} d={`M${rx} ${y} l9 -11`} {...s} />
      </>
    );
  if (action === "sleep" || action === "worry") return <path d={`M${lx} ${y} l-6 9 M${rx} ${y} l6 9`} {...s} />;
  return <path d={`M${lx} ${y} l-6 9 M${rx} ${y} l8 2`} {...s} />;
}

function Cabbage({ action }: { action: Action }) {
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
      <Arms lx={20} rx={82} y={72} action={action} />
      <Prop action={action} hx={88} hy={76} />
    </g>
  );
}

function Carrot({ action }: { action: Action }) {
  return (
    <g>
      <path d="M44 30 C40 18 42 10 47 8 M52 30 C54 16 60 10 64 12 M48 30 C46 22 50 14 56 18" stroke={INK} strokeWidth={9} strokeLinecap="round" fill="none" />
      <path d="M44 30 C40 18 42 10 47 8 M52 30 C54 16 60 10 64 12 M48 30 C46 22 50 14 56 18" stroke="#6fb33a" strokeWidth={4.5} strokeLinecap="round" fill="none" />
      <path d="M30 40 C30 30 68 28 70 40 C70 60 58 86 50 104 C46 106 44 104 42 98 C34 78 30 58 30 40 Z" fill="#f98f1d" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <path d="M36 70 h7 M55 80 h6 M40 88 h5" stroke={INK} strokeWidth={2.5} strokeLinecap="round" />
      <Face x={50} y={48} action={action} />
      <Arms lx={32} rx={68} y={62} action={action} />
      <Prop action={action} hx={74} hy={66} />
    </g>
  );
}

function Fish({ action }: { action: Action }) {
  return (
    <g>
      <path d="M78 66 L96 50 L94 84 Z" fill="#cfdcd5" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <path d="M12 66 C18 40 44 34 62 42 C72 46 78 56 80 66 C78 76 72 86 62 90 C44 98 18 92 12 66 Z" fill="#f2f6f3" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
      <path d="M44 58 C50 62 50 72 44 78" stroke="#b8c9bf" strokeWidth={3} strokeLinecap="round" fill="none" />
      <Face x={28} y={62} action={action} />
      <Arms lx={34} rx={56} y={86} action={action} />
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
};

/** One character, or the whole crew side by side. No frame: it stands on the page. */
export function MascotFigure({ who, action, size = 72 }: { who: Who; action: Action; size?: number }) {
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
            <Body action={action} />
          </svg>
        );
      })}
    </span>
  );
}

function readTucked() {
  try {
    return localStorage.getItem("sopbox-mascot-tucked") === "1";
  } catch {
    return false;
  }
}

/** The corner dock: the current scene with a speech bubble and, when known, a progress bar. */
export function MascotDock({ fallback }: { fallback: Scene }) {
  const scene = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  ) ?? fallback;
  const [tucked, setTucked] = useState(readTucked);
  const toggle = () =>
    setTucked((t) => {
      try {
        localStorage.setItem("sopbox-mascot-tucked", t ? "0" : "1");
      } catch {
        /* the choice just won't be remembered */
      }
      return !t;
    });

  let bubble: ReactNode = null;
  if (scene.text && !tucked)
    bubble = (
      <div className="mascot-pop mb-10 max-w-52 rounded-2xl rounded-br-sm bg-white px-3 py-2 text-xs font-medium text-ink shadow-lg ring-1 ring-line sm:max-w-60 sm:text-sm">
        <p aria-live="polite">{scene.text}</p>
        {scene.progress !== undefined && (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-600 transition-all duration-500" style={{ width: `${Math.round(Math.min(1, Math.max(0, scene.progress)) * 100)}%` }} />
          </div>
        )}
      </div>
    );

  return (
    <div className="pointer-events-none fixed bottom-2 right-2 z-20 flex items-end gap-1 print:hidden sm:bottom-4 sm:right-4">
      {bubble}
      <button
        type="button"
        onClick={toggle}
        className={`pointer-events-auto rounded-full transition-transform focus-visible:outline-2 focus-visible:outline-brand-600 ${tucked ? "translate-y-1/2 opacity-80" : ""}`}
        aria-label={tucked ? "Show the helper's messages" : "Hide the helper's messages"}
        title={tucked ? "Show messages" : "Hide messages"}
      >
        <MascotFigure who={scene.who} action={scene.action} size={tucked ? 44 : 64} />
      </button>
    </div>
  );
}
