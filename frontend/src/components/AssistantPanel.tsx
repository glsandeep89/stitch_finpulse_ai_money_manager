import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

type Msg = { role: "user" | "assistant"; content: string };

const ROUTE_HINTS: Record<string, string> = {
  "/": "Overview",
  "/creditcards": "Credit Cards",
  "/investments": "Investments",
  "/mortgage": "Mortgage",
  "/insights": "Insights",
  "/budget": "Budget",
  "/household": "Household",
  "/settings": "Settings",
  "/settings/advanced": "Settings (advanced AI controls)",
};

export function AssistantPanel() {
  const { session } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"query" | "advice">("advice");
  const [voiceDraft, setVoiceDraft] = useState<{ amount: number; category: string; merchant_name: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const routeHint = ROUTE_HINTS[location.pathname] ?? location.pathname;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !session?.access_token) return;
    setErr(null);
    setBusy(true);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setInput("");
    try {
      const res = await api<{ reply: string }>("/ai/chat", {
        method: "POST",
        accessToken: session.access_token,
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          routeHint,
        }),
      });
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Request failed");
      setMessages(messages);
    } finally {
      setBusy(false);
    }
  }, [input, messages, session?.access_token, routeHint]);

  const buildVoiceDraft = useCallback(async () => {
    if (!session?.access_token || typeof window === "undefined") return;
    const Ctor = (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!Ctor && !("SpeechRecognition" in window)) {
      setErr("Voice recognition is not available in this browser.");
      return;
    }
    const Rec = (window as unknown as { SpeechRecognition?: new () => any }).SpeechRecognition ?? Ctor;
    const rec = new Rec();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = async (event: any) => {
      const utterance = event.results?.[0]?.[0]?.transcript ?? "";
      if (!utterance.trim()) return;
      try {
        const out = await api<{ draft: { amount: number; category: string; merchant_name: string } }>(
          "/ai/voice-log-draft",
          {
            method: "POST",
            accessToken: session.access_token,
            body: JSON.stringify({ utterance }),
          }
        );
        setVoiceDraft(out.draft);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Voice draft failed");
      }
    };
    rec.onerror = () => setErr("Voice recognition failed.");
    rec.start();
  }, [session?.access_token]);

  const quick = (prompt: string) => {
    setInput(prompt);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-24 md:bottom-8 right-4 z-[60] h-14 w-14 rounded-full bg-primary text-on-primary shadow-lg flex items-center justify-center hover:opacity-95"
        aria-expanded={open}
        aria-controls="finpulse-assistant-panel"
        title="Open assistant"
      >
        <span className="material-symbols-outlined text-2xl">chat</span>
      </button>

      {open ? (
        <div
          id="finpulse-assistant-panel"
          className="fixed bottom-40 md:bottom-24 right-4 z-[60] w-[min(100vw-2rem,22rem)] max-h-[70vh] flex flex-col rounded-2xl border border-outline-variant/20 bg-surface-container-lowest shadow-2xl"
          role="dialog"
          aria-label="FinPulse assistant"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/15">
            <span className="font-headline text-sm font-semibold text-on-surface">Assistant</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-on-surface-variant hover:text-on-surface"
              aria-label="Close assistant"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
          <div className="px-3 py-2 flex flex-wrap gap-1 border-b border-outline-variant/10">
            <div className="w-full mb-1 flex gap-1">
              <button
                type="button"
                onClick={() => setMode("advice")}
                className={`text-[10px] px-2 py-1 rounded-full ${mode === "advice" ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant"}`}
              >
                Advice mode
              </button>
              <button
                type="button"
                onClick={() => setMode("query")}
                className={`text-[10px] px-2 py-1 rounded-full ${mode === "query" ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant"}`}
              >
                Query mode
              </button>
              <button
                type="button"
                onClick={() => void buildVoiceDraft()}
                className="text-[10px] px-2 py-1 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface"
              >
                Voice quick-log
              </button>
            </div>
            {[
              "Summarize my recent spending.",
              "What should I watch on my budget?",
              "Any unusual transactions lately?",
            ].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() =>
                  quick(mode === "query" ? `Query: ${p.replace("Summarize my recent spending.", "How much did I spend last month?")}` : p)
                }
                className="text-[10px] px-2 py-1 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface"
              >
                {p.length > 36 ? `${p.slice(0, 34)}…` : p}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-[120px] max-h-[38vh]">
            {messages.length === 0 ? (
              <p className="text-xs text-on-surface-variant font-body">
                Ask about your spending. Replies use recent transaction context and respect your scope (Just me /
                Household).
              </p>
            ) : (
              messages.map((m, i) => (
                <div
                  key={`${i}-${m.role}`}
                  className={`text-sm font-body rounded-xl px-3 py-2 ${
                    m.role === "user"
                      ? "bg-primary-container text-on-primary-container ml-4"
                      : "bg-surface-container-low text-on-surface mr-4"
                  }`}
                >
                  {m.content}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
          {err ? <p className="px-3 text-xs text-error">{err}</p> : null}
          {voiceDraft ? (
            <div className="px-3 pb-2 text-xs text-on-surface-variant">
              Voice draft: {voiceDraft.merchant_name} · ${voiceDraft.amount.toFixed(2)} · {voiceDraft.category}
            </div>
          ) : null}
          <div className="p-3 border-t border-outline-variant/15 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask FinPulse…"
              className="flex-1 text-sm rounded-xl border border-outline-variant/30 px-3 py-2 bg-surface-container-low"
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="px-3 py-2 rounded-xl bg-secondary-container text-on-secondary-container text-sm disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
