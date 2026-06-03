export interface PageContext {
  path?: string;
  planId?: number;
  weekStartDate?: string;
  mealId?: number;
  plannedMealId?: number;
}

export interface ChatResponse {
  message: string;
  toolCalls: { name: string; input: unknown; output: unknown; isError: boolean }[];
}

export interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

export async function sendMessage(
  message: string,
  pageContext: PageContext = {},
  history: HistoryItem[] = [],
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, pageContext, history }),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string; details?: string });
    const error = body.error ?? "Chat failed";
    const details = body.details ?? `HTTP ${res.status}`;
    throw new Error(`${error}: ${details}`);
  }
  return res.json();
}

export type StreamEvent =
  | { type: "tool_call_start"; name: string }
  | { type: "tool_call_end"; name: string; isError: boolean }
  | { type: "text_delta"; delta: string }
  | { type: "done"; message: string; toolCalls: { name: string; input: unknown; output: unknown; isError: boolean }[] }
  | { type: "error"; error: string };

export async function* sendMessageStream(
  message: string,
  pageContext: PageContext = {},
  history: HistoryItem[] = [],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, pageContext, history }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}) as any);
    throw new Error(`${body.error ?? "Chat stream failed"}: ${body.details ?? res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const json = trimmed.slice(5).trim();
      if (!json) continue;
      try {
        yield JSON.parse(json) as StreamEvent;
      } catch {
        // skip malformed events
      }
    }
  }
}
