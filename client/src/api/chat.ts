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
): Promise<ChatResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, pageContext, history }),
  });
  if (!res.ok) throw new Error("Chat failed");
  return res.json();
}
