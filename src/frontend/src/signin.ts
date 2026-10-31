import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api } from "./api";
import type { Me, SignIn, TelegramAuth } from "./types";

/**
 * The browser side of the other sign-in methods. Google and Telegram leave the site and come back:
 * Google to /signin or /settings with a short result code, Telegram with its signed answer in the
 * address after "#tgAuthResult=". `takeAuthReturn` reads that once and tidies the address.
 */

export const METHOD_LABEL: Record<string, string> = {
  password: "password",
  register: "creating the workspace",
  passkey: "a passkey",
  google: "Google",
  telegram: "Telegram",
  kitchen_pin: "kitchen tablet PIN",
};

// The way this browser last signed in, marked "Last used" on the sign-in page. Only the method is
// kept, never who: a shared phone shows no one's name.
const LAST = "sopbox-last-sign-in";
export type ShownMethod = "password" | "passkey" | "google" | "telegram";

export function rememberSignIn(method: string | null | undefined) {
  if (!method || !["password", "passkey", "google", "telegram"].includes(method)) return;
  try {
    localStorage.setItem(LAST, method);
    localStorage.setItem(`${LAST}-at`, new Date().toISOString());
  } catch {
    // Private windows may refuse storage; the badge is only a convenience.
  }
}

export function lastSignIn(): ShownMethod | null {
  try {
    return localStorage.getItem(LAST) as ShownMethod | null;
  } catch {
    return null;
  }
}

/** When this device last signed in, as "31 Oct, 14:05", or "" before this was remembered. */
export function lastSignInAt(): string {
  try {
    const at = new Date(localStorage.getItem(`${LAST}-at`) ?? "");
    if (isNaN(at.getTime())) return "";
    return at.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "";
  }
}

export const describeSignIn = (s: SignIn) =>
  `${new Date(s.at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} with ${METHOD_LABEL[s.method] ?? s.method} on ${s.device}`;

// Codes the server puts in the address; the words live here so a crafted link cannot show its own text.
const RESULT: Record<string, string> = {
  google_not_linked: "That Google account isn't connected to SOPBox yet. Sign in with your password, then connect Google in Settings.",
  google_taken: "That Google account is already connected to another SOPBox account.",
  google_cancelled: "Google sign-in was cancelled.",
  google_expired: "That sign-in took too long. Please try again.",
  google_failed: "Google couldn't confirm the sign-in. Please try again.",
  unavailable: "Google sign-in isn't available right now.",
  telegram_cancelled: "Telegram sign-in was cancelled.",
};

export type AuthReturn = { error?: string; notice?: string; telegram?: TelegramAuth };

let taken: AuthReturn | null = null;

/** What the last trip to Google or Telegram brought back, once per page load. */
export function takeAuthReturn(): AuthReturn {
  if (taken) return taken;
  const url = new URL(window.location.href);
  const out: AuthReturn = {};
  const error = url.searchParams.get("auth_error");
  if (error) out.error = RESULT[error] ?? RESULT.google_failed;
  if (url.searchParams.get("linked") === "google") out.notice = "Google is connected. Next time, tap Continue with Google.";
  const tg = url.hash.match(/tgAuthResult=([^&]*)/);
  if (tg) {
    try {
      const b64 = tg[1].replace(/-/g, "+").replace(/_/g, "/");
      const data = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
      if (data && typeof data === "object") out.telegram = data as TelegramAuth;
      else out.error = RESULT.telegram_cancelled;
    } catch {
      out.error = RESULT.telegram_cancelled;
    }
  }
  if (error || url.searchParams.has("linked") || tg) window.history.replaceState(null, "", url.pathname);
  taken = out;
  return out;
}

/** Telegram's answer, handed out once so it is only sent to the server once. */
export function consumeTelegram(): TelegramAuth | undefined {
  const { telegram } = takeAuthReturn();
  if (taken) taken = { ...taken, telegram: undefined };
  return telegram;
}

/** Telegram's own login page; it sends the person back to `returnPath` on this site. */
export function telegramLoginUrl(botId: string, returnPath: "/signin" | "/settings") {
  const origin = window.location.origin;
  const query = new URLSearchParams({ bot_id: botId, origin, embed: "0", request_access: "write", return_to: origin + returnPath });
  return `https://oauth.telegram.org/auth?${query}`;
}

export const passkeysSupported = () => typeof window.PublicKeyCredential === "function";

export async function signInWithPasskey(): Promise<Me> {
  const optionsJSON = (await api.passkeyLoginOptions()) as unknown as Parameters<typeof startAuthentication>[0]["optionsJSON"];
  return api.passkeyLogin(await startAuthentication({ optionsJSON }));
}

export async function addPasskey(name: string) {
  const optionsJSON = (await api.passkeyRegisterOptions()) as unknown as Parameters<typeof startRegistration>[0]["optionsJSON"];
  return api.addPasskey(await startRegistration({ optionsJSON }), name);
}

/** A name like "Android phone" for the passkey this device is about to make. */
export function thisDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux computer";
  return "Computer";
}

/** Turn a browser's "the person closed the passkey prompt" into plain words. */
export function passkeyError(e: unknown) {
  const name = (e as { name?: string }).name;
  if (name === "NotAllowedError" || name === "AbortError") return "The passkey prompt was closed. Try again when you're ready.";
  if (name === "InvalidStateError") return "This device already has a passkey for you.";
  return (e as Error).message;
}
