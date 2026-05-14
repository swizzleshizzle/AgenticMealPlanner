import { Router } from "express";
import { handleChatMessage } from "../services/chatService.js";

const router = Router();

interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

router.post("/", async (req, res) => {
  const { message, pageContext, history } = req.body ?? {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required" });
    return;
  }
  const safeHistory: HistoryItem[] = Array.isArray(history)
    ? history
        .filter((h: any) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
        .slice(-20) // cap to prevent unbounded growth
    : [];
  try {
    const result = await handleChatMessage(message, pageContext ?? {}, safeHistory);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Chat failed", details: err.message });
  }
});

export default router;
