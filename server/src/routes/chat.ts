import { Router } from "express";
import { handleChatMessage } from "../services/chatService.js";
import { runAgentStream } from "../agent/runner.js";

const router = Router();

interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

function sanitizeHistory(raw: unknown): HistoryItem[] {
  // Caps: 50 prior turns (≈25 back-and-forth), 4000 chars per item. Items
  // over the char cap have their START truncated so the recent half survives.
  const HISTORY_MAX_ITEMS = 50;
  const HISTORY_MAX_CHARS_PER_ITEM = 4000;
  return Array.isArray(raw)
    ? (raw as any[])
        .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
        .slice(-HISTORY_MAX_ITEMS)
        .map((h: HistoryItem) =>
          h.content.length <= HISTORY_MAX_CHARS_PER_ITEM
            ? h
            : { role: h.role, content: "…[truncated]" + h.content.slice(-(HISTORY_MAX_CHARS_PER_ITEM - 14)) },
        )
    : [];
}

router.post("/", async (req, res) => {
  const { message, pageContext, history } = req.body ?? {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required" });
    return;
  }
  const safeHistory = sanitizeHistory(history);
  try {
    const result = await handleChatMessage(message, pageContext ?? {}, safeHistory);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Chat failed", details: err.message });
  }
});

router.post("/stream", async (req, res) => {
  const { message, pageContext, history } = req.body ?? {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required" });
    return;
  }
  const safeHistory = sanitizeHistory(history);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // res "close" fires when the client drops the TCP connection (navigate
  // away, AbortController). req "close" fires as soon as the request body is
  // fully sent -- too early, before the agent finishes -- so we use res here.
  // Aborting the controller cancels the underlying SDK query so the agent
  // stops working (and stops mutating the DB), not just stops being written to.
  const abortController = new AbortController();
  let disconnected = false;
  res.on("close", () => {
    disconnected = true;
    abortController.abort();
  });

  // Guard: skip writing if the socket is gone.
  const send = (ev: any) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };

  try {
    for await (const ev of runAgentStream({ userMessage: message, pageContext: pageContext ?? {}, history: safeHistory, abortController })) {
      if (disconnected) break;
      send(ev);
    }
  } catch (err: any) {
    send({ type: "error", error: err.message ?? "stream failed" });
  } finally {
    res.end();
  }
});

export default router;
