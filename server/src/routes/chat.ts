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
  // Caps: 50 prior turns (≈25 back-and-forth), 4000 chars per item. Items
  // over the char cap have their START truncated so the recent half survives.
  const HISTORY_MAX_ITEMS = 50;
  const HISTORY_MAX_CHARS_PER_ITEM = 4000;
  const safeHistory: HistoryItem[] = Array.isArray(history)
    ? history
        .filter((h: any) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
        .slice(-HISTORY_MAX_ITEMS)
        .map((h: HistoryItem) =>
          h.content.length <= HISTORY_MAX_CHARS_PER_ITEM
            ? h
            : { role: h.role, content: "…[truncated]" + h.content.slice(-(HISTORY_MAX_CHARS_PER_ITEM - 14)) },
        )
    : [];
  try {
    const result = await handleChatMessage(message, pageContext ?? {}, safeHistory);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Chat failed", details: err.message });
  }
});

export default router;
