import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Send, X } from "lucide-react";
import { api } from "./api";
import type { PageId } from "./App";
import type { AssistantAction, AssistantMessage, AssistantReply } from "./types";

const SUGGESTIONS = ["What should I do today?", "What should we order?", "What expires soon?", "What went missing this week?"];

type Turn = { key: number; question: string; answer: AssistantReply | null; error: string };

/**
 * A small chat with the assistant. It answers from the records through fixed queries on the
 * server and offers buttons to the page for the next step; it never changes anything itself.
 */
/** A step the assistant suggested: it runs only when tapped, through the usual route and its checks. */
function ActionButton({ action, go, onClose }: { action: AssistantAction; go: (page: PageId) => void; onClose: () => void }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [note, setNote] = useState("");
  async function run() {
    setState("busy");
    setNote("");
    try {
      const order = await api.lowStockDraft(action.supplier_id, new Date().toLocaleDateString("en-CA"));
      setNote(`${order.reference} drafted. Check it before you send it.`);
      setState("done");
    } catch (e) {
      setNote((e as Error).message);
      setState("idle");
    }
  }
  if (state === "done")
    return (
      <p className="mt-2 text-xs">
        {note}{" "}
        <button
          type="button"
          className="font-semibold text-brand-700 hover:underline"
          onClick={() => {
            go("purchasing");
            onClose();
          }}
        >
          Open it
        </button>
      </p>
    );
  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={state === "busy"}
        className="rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        onClick={() => void run()}
      >
        {state === "busy" ? "Working…" : action.label}
      </button>
      {note && <p className="mt-1 text-xs text-red-800">{note}</p>}
    </div>
  );
}

export function AskPanel({ go, onClose }: { go: (page: PageId) => void; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // Block bodies: newer browsers return a promise from scrollIntoView, and React would take a
  // returned value for a cleanup function.
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  async function ask(question: string) {
    question = question.trim();
    if (!question || busy) return;
    const key = Date.now();
    setTurns((all) => [...all, { key, question, answer: null, error: "" }]);
    setText("");
    setBusy(true);
    try {
      // The last few answered turns go along, so a follow-up question makes sense.
      const history: AssistantMessage[] = turns
        .filter((t) => t.answer)
        .slice(-5)
        .flatMap((t) => [
          { role: "user" as const, content: t.question },
          { role: "assistant" as const, content: t.answer!.text.slice(0, 1500) },
        ]);
      const answer = await api.assistant([...history, { role: "user", content: question }]);
      setTurns((all) => all.map((t) => (t.key === key ? { ...t, answer } : t)));
    } catch (e) {
      setTurns((all) => all.map((t) => (t.key === key ? { ...t, error: (e as Error).message } : t)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Ask the helper"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="mascot-pop pointer-events-auto fixed bottom-[calc(9.5rem+env(safe-area-inset-bottom))] right-2 z-30 lg:bottom-20 flex max-h-[min(32rem,60vh)] lg:max-h-[min(32rem,70vh)] w-[min(22rem,calc(100vw-1rem))] flex-col rounded-2xl bg-white text-sm text-ink shadow-xl ring-1 ring-line print:hidden sm:bottom-24 sm:right-4"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="font-bold text-brand-950">Assistant</p>
        <button type="button" className="rounded-full p-1 text-muted hover:bg-slate-100 hover:text-ink" aria-label="Close" onClick={onClose}>
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-muted">Ask about your stock, orders and prices, or what to do next. Try:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t) => (
          <div key={t.key} className="space-y-1.5">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3 py-2 text-white">{t.question}</p>
            <div className="w-fit max-w-[92%] rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2">
              {t.error ? (
                <p className="text-red-800">{t.error}</p>
              ) : !t.answer ? (
                <p className="inline-flex items-center gap-2 text-muted">
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Looking…
                </p>
              ) : (
                <>
                  <p className="whitespace-pre-line">{t.answer.text}</p>
                  {t.answer.actions.map((action) => (
                    <ActionButton key={action.supplier_id} action={action} go={go} onClose={onClose} />
                  ))}
                  {t.answer.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {t.answer.links.map((link) => (
                        <button
                          key={link.page}
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                          onClick={() => {
                            go(link.page as PageId);
                            onClose();
                          }}
                        >
                          {link.label} <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>

      <form
        className="flex gap-2 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <label className="sr-only" htmlFor="ask-question">
          Your question
        </label>
        <input
          id="ask-question"
          ref={input}
          maxLength={1000}
          autoComplete="off"
          placeholder="e.g. How fast do we use rice?"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand-500 sm:text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Ask" className="rounded-xl bg-brand-600 px-3 text-white hover:bg-brand-700 disabled:opacity-50">
          <Send aria-hidden className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
