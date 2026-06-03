import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles, Send } from "lucide-react";
import { sendMessageStream } from "../api/chat";
import type { HistoryItem, StreamEvent } from "../api/chat";
import { derivePageContext } from "../api/pageContext";
import Button from "./ui/Button";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ToolCall { name: string; isError: boolean; }
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  isGreeting?: boolean;
}

function newId(): string {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `m_${Math.random().toString(36).slice(2)}_${performance.now()}`;
}

const SUGGESTIONS = [
  "Swap Wednesday dinner for something with chicken",
  "We're eating out Friday, skip that meal",
  "What can I make with what's left in the fridge?",
  "Scale Sunday's meal prep to 6 servings instead of 4",
];

const GREETING_MESSAGE = "Hey! I'm your meal planning sidekick. Ask me to swap meals, scale portions, or check what's in the fridge.";
const GREETING_ID = "greeting";


export default function ChatPanel() {
  const location = useLocation();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: GREETING_ID,
      role: "assistant",
      content: GREETING_MESSAGE,
      isGreeting: true,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    // Abort any in-flight request from a prior send (defense in depth --
    // the `loading` guard above usually catches this).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Derive history from current messages BEFORE any state mutation.
    // Exclude the initial greeting (it's not a real model turn).
    const history: HistoryItem[] = messages
      .filter((m) => !m.isGreeting)
      .map((m) => ({ role: m.role, content: m.content }));

    setInput("");
    setMessages((prev) => [...prev, { id: newId(), role: "user", content: text }]);
    setLoading(true);
    try {
      const pageContext = derivePageContext(location);
      const draftId = newId();
      setMessages((prev) => [...prev, { id: draftId, role: "assistant", content: "", toolCalls: [] }]);

      for await (const ev of sendMessageStream(text, pageContext, history, controller.signal)) {
        if (ev.type === "text_delta") {
          setMessages((prev) => prev.map((m) => m.id === draftId ? { ...m, content: m.content + ev.delta } : m));
        } else if (ev.type === "tool_call_start") {
          setMessages((prev) => prev.map((m) => m.id === draftId ? { ...m, toolCalls: [...(m.toolCalls ?? []), { name: ev.name, isError: false }] } : m));
        } else if (ev.type === "tool_call_end") {
          setMessages((prev) => prev.map((m) => {
            if (m.id !== draftId) return m;
            const tcs = [...(m.toolCalls ?? [])];
            for (let i = tcs.length - 1; i >= 0; i--) {
              if (tcs[i].name === ev.name) { tcs[i] = { name: ev.name, isError: ev.isError }; break; }
            }
            return { ...m, toolCalls: tcs };
          }));
        } else if (ev.type === "done") {
          setMessages((prev) => prev.map((m) => m.id === draftId ? { ...m, content: ev.message, toolCalls: ev.toolCalls.map((tc) => ({ name: tc.name, isError: tc.isError })) } : m));
        } else if (ev.type === "error") {
          throw new Error(ev.error);
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: `Sorry — ${err.message ?? "request failed"}` }]);
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  };

  const clearConversation = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setMessages([
      {
        id: GREETING_ID,
        role: "assistant",
        content: GREETING_MESSAGE,
        isGreeting: true,
      },
    ]);
    setInput("");
  };

  return (
    <div className="flex flex-col gap-5 h-full">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-[10px] bg-accent-soft text-accent-ink grid place-items-center">
          <Sparkles size={17} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-[20px] sm:text-[22px] font-semibold -tracking-[0.02em] text-ink-1">
            Kitchen Assistant
          </h1>
          <div className="text-[12px] text-ink-3">Claude · knows your plan, pantry, and recipes</div>
        </div>
        <button
          onClick={clearConversation}
          className="text-[12px] px-3 py-1.5 rounded-full bg-surface-1 border border-line text-ink-2 hover:bg-surface-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={messages.length <= 1}
        >
          New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-1">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] sm:max-w-[78%] rounded-[16px] px-4 py-3 text-[14px] leading-relaxed ${
                m.role === "user"
                  ? "bg-accent text-accent-on"
                  : "bg-surface-1 text-ink-1 border border-line shadow-[var(--shadow-card)]"
              }`}
            >
              <div className="text-[14px] leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_a]:underline [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:bg-surface-2 [&_pre]:rounded [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:text-[12px] [&_pre]:my-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px] [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-3 [&_blockquote]:my-1 [&_h1]:text-[18px] [&_h1]:font-semibold [&_h1]:my-2 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:my-1.5 [&_h3]:font-semibold [&_h3]:my-1 [&_table]:w-full [&_table]:text-[13px] [&_table]:my-2 [&_th]:text-left [&_th]:border-b [&_th]:border-line [&_th]:pb-1 [&_th]:pr-3 [&_td]:py-0.5 [&_td]:pr-3 [&_strong]:font-semibold">
                <Markdown remarkPlugins={[remarkGfm]} disallowedElements={["script", "iframe", "img"]}
                  unwrapDisallowed
                  components={{
                    a: ({ node, ...props }: any) => <a {...props} target="_blank" rel="noopener noreferrer" />,
                  }}
                >
                  {m.content}
                </Markdown>
              </div>
              {m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {m.toolCalls.map((tc, j) => (
                    <span
                      key={j}
                      className={`text-[11px] px-2 py-[2px] rounded-full border ${
                        tc.isError
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-surface-2 text-ink-3 border-line"
                      }`}
                      title={tc.isError ? "Tool call failed" : "Tool call succeeded"}
                    >
                      🔧 {tc.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface-1 border border-line rounded-[16px] px-4 py-3.5 flex gap-1">
              <Dot delay={0} /><Dot delay={120} /><Dot delay={240} />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div>
        <div className="flex gap-1.5 mb-2.5 flex-wrap">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => handleSend(s)}
              disabled={loading}
              className="text-[12px] px-3 py-[5px] bg-surface-1 border border-line rounded-full text-ink-2 hover:border-accent-line hover:text-ink-1 transition disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center bg-surface-1 border border-line rounded-[14px] py-2 pl-4 pr-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask anything about your meals…"
            disabled={loading}
            className="flex-1 bg-transparent border-0 outline-none text-[14px] text-ink-1 placeholder:text-ink-3"
          />
          <Button variant="primary" icon={Send} onClick={() => handleSend()} disabled={loading || !input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="w-2 h-2 rounded-full bg-ink-3 animate-bounce"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}
