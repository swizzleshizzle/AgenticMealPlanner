import { runAgent } from "../agent/runner.js";
import type { PageContext } from "../agent/types.js";

export interface ChatResult {
  message: string;
  toolCalls: { name: string; input: unknown; output: unknown; isError: boolean }[];
}

export async function handleChatMessage(
  message: string,
  pageContext: PageContext = {},
): Promise<ChatResult> {
  return await runAgent({ userMessage: message, pageContext });
}
