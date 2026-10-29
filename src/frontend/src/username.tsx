import { useEffect, useState } from "react";
import { api } from "./api";

// Mirrors the server's rule in src/backend/app/models.py (_USERNAME): 3 to 32 of a-z, 0-9 and
// . _ -, starting and ending with a letter or number.
export const USERNAME_PATTERN = "[a-z0-9][a-z0-9._\\-]{1,30}[a-z0-9]";
export const USERNAME_HINT = "3 to 32 characters: letters a-z, numbers, and . _ - only. No spaces or other symbols.";

/** Clean a username as it is typed: full-width letters become plain ones, upper case becomes
 *  lower, and anything else that cannot be part of a username is dropped. `removed` says whether
 *  something was dropped, so the form can say why it vanished. */
export function cleanUsername(typed: string): { value: string; removed: boolean } {
  const normal = typed.normalize("NFKC").toLowerCase();
  const value = normal.replace(/[^a-z0-9._-]/g, "").slice(0, 32);
  return { value, removed: value !== normal.slice(0, 32) && normal.length > 0 };
}

/** The reason a cleaned username would still be refused, or "" if it is fine. */
export function usernameProblem(value: string): string {
  if (value.length < 3) return "Use at least 3 characters.";
  if (!/^[a-z0-9]/.test(value) || !/[a-z0-9]$/.test(value)) return "Start and end with a letter or number.";
  return "";
}

/** Whether a username is free, checked 300 ms after typing stops. null when there is nothing to
 *  check: an empty or unchanged name, or one the rule above already refuses. Save checks again. */
export function useUsernameCheck(value: string, unchanged = false): { available: boolean | null; message: string } | null {
  const [result, setResult] = useState<{ for: string; available: boolean | null; message: string } | null>(null);
  const skip = unchanged || !value || usernameProblem(value) !== "";
  useEffect(() => {
    if (skip) return;
    let live = true;
    const timer = window.setTimeout(() => {
      api
        .usernameAvailable(value)
        .then((r) => live && setResult({ for: value, available: r.available, message: r.available ? "Available" : r.problem }))
        .catch(() => live && setResult({ for: value, available: null, message: "" }));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [value, skip]);
  if (skip) return null;
  if (result?.for !== value) return { available: null, message: "Checking…" };
  return result;
}

/** The check's result under a username field. */
export function UsernameStatus({ check }: { check: ReturnType<typeof useUsernameCheck> }) {
  if (!check?.message) return null;
  const colour = check.available === true ? "text-emerald-700" : check.available === false ? "text-red-700" : "text-muted";
  return (
    <p className={`mt-1 text-xs font-semibold ${colour}`} aria-live="polite">
      {check.message}
    </p>
  );
}
