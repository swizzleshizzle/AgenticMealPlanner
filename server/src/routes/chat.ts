import { Router } from "express";
import { handleChatMessage } from "../services/chatService.js";

const router = Router();

router.post("/", async (req, res) => {
  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: "Message is required" });
    return;
  }

  try {
    const response = await handleChatMessage(message);
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: "Chat failed", details: err.message });
  }
});

export default router;
