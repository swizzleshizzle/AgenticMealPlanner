import { useState, useRef, useEffect } from "react";
import { sendMessage, type ChatResponse } from "../api/chat";
import ChatMessage from "../components/ChatMessage";

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: { type: string; applied: boolean }[];
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hey! I'm your meal planning assistant. Ask me to swap meals, update your plan, check what's in the fridge, or anything else." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const res: ChatResponse = await sendMessage(userMsg);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: res.message,
        actions: res.actions.map((a, i) => ({ type: a.type, applied: res.applied[i] })),
      }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, something went wrong. Try again?" }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Chat</h2>
      <div className="flex-1 overflow-y-auto mb-4 pr-2">
        {messages.map((msg, i) => (<ChatMessage key={i} {...msg} />))}
        {loading && (
          <div className="flex justify-start mb-4">
            <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="e.g. Swap Tuesday dinner for something with chicken..."
          className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={loading} />
        <button onClick={handleSend} disabled={loading || !input.trim()}
          className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          Send
        </button>
      </div>
    </div>
  );
}
