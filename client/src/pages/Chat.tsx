import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sparkles, Send } from "lucide-react";
import { sendMessage } from "../api/chat";
import type { HistoryItem } from "../api/chat";
import { derivePageContext } from "../api/pageContext";
import Button from "../components/ui/Button";

interface ToolCall {
  name: string;
  isError: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  isGreeting?: boolean;
}

const SUGGESTIONS = [
  "Swap Wednesday dinner for something with chicken",
  "We're eating out Friday, skip that meal",
  "What can I make with what's left in the fridge?",
  "Scale Sunday's meal prep to 6 servings instead of 4",
];

function formatBold(text: string): string {
  // Tiny safe formatter: only **bold** spans; everything else escaped
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export default function Chat() {
  const location = useLocation();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hey! I'm your meal planning sidekick. Ask me to swap meals, scale portions, or check what's in the fridge.",
      isGreeting: true,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    // Derive history from current messages BEFORE any state mutation.
    // Exclude the initial greeting (it's not a real model turn).
    const history: HistoryItem[] = messages
      .filter((m) => !m.isGreeting)
      .map((m) => ({ role: m.role, content: m.content }));

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    try {
      const pageContext = derivePageContext(location);
      const res = await sendMessage(text, pageContext, history);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.message,
          toolCalls: res.toolCalls?.map((tc) => ({ name: tc.name, isError: tc.isError })),
        },
      ]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry — I couldn't reach the assistant. Try again?" }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 max-w-[780px] h-[calc(100vh-160px)] lg:h-[calc(100vh-72px)]">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-[10px] bg-accent-soft text-accent-ink grid place-items-center">
          <Sparkles size={17} />
        </div>
        <div>
          <h1 className="text-[20px] sm:text-[22px] font-semibold -tracking-[0.02em] text-ink-1">
            Kitchen Assistant
          </h1>
          <div className="text-[12px] text-ink-3">Claude · knows your plan, pantry, and recipes</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-1">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] sm:max-w-[78%] rounded-[16px] px-4 py-3 text-[14px] leading-relaxed ${
                m.role === "user"
                  ? "bg-accent text-accent-on"
                  : "bg-surface-1 text-ink-1 border border-line shadow-[var(--shadow-card)]"
              }`}
            >
              <div dangerouslySetInnerHTML={{ __html: formatBold(m.content) }} />
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
