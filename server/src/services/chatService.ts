import { runAgent } from "../agent/runner.js";
import type { PageContext } from "../agent/types.js";

export interface ChatResult {
  message: string;
  toolCalls: { name: string; input: unknown; output: unknown; isError: boolean }[];
}

export interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

export async function handleChatMessage(
  message: string,
  pageContext: PageContext = {},
  history: HistoryItem[] = [],
): Promise<ChatResult> {
  return await runAgent({ userMessage: message, pageContext, history });
}
