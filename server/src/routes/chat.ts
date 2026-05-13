import { Router } from "express";
import { handleChatMessage } from "../services/chatService.js";

const router = Router();

router.post("/", async (req, res) => {
  const { message, pageContext } = req.body ?? {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message is required" });
    return;
  }
  try {
    const result = await handleChatMessage(message, pageContext ?? {});
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Chat failed", details: err.message });
  }
});

export default router;
