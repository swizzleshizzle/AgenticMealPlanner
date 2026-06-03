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
