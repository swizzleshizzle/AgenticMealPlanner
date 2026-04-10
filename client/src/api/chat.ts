export interface ChatAction {
  type: string;
  params: Record<string, any>;
}

export interface ChatResponse {
  message: string;
  actions: ChatAction[];
  applied: boolean[];
}

export async function sendMessage(message: string): Promise<ChatResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error("Chat failed");
  return res.json();
}
