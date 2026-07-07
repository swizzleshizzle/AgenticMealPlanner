import { Router } from "express";
import { upload } from "../middleware/upload.js";
import * as receiptService from "../services/receiptService.js";
import path from "path";

const router = Router();

router.post("/parse", upload.single("file"), async (req, res) => {
  try {
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if (!req.file && !text) {
      return res.status(400).json({ error: "Either a file or non-empty 'text' is required." });
    }

    let result;
    if (text) {
      result = await receiptService.parseReceipt({ kind: "text", text });
    } else if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const kind = ext === ".pdf" ? "pdf" : "photo";
      result = await receiptService.parseReceipt({ kind, path: req.file.path });
    } else {
      return res.status(400).json({ error: "Unreachable" });
    }

    res.json(result);
  } catch (err: any) {
    console.error("[receipts/parse] failed", err);
    res.status(500).json({ error: "Failed to parse receipt", details: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const receipt = await receiptService.commitReceipt(req.body);
    res.status(201).json(receipt);
  } catch (err: any) {
    console.error("[receipts/commit] failed", err);
    const status = /expired|not found/i.test(err.message) ? 410 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  // Clamp to [1, 50] and fall back to 5 for missing/NaN/<=0 values, so a bad
  // ?limit can't produce `take: NaN` (Prisma 500) or a negative take.
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 5));
  const receipts = await receiptService.getRecentReceipts(limit);
  res.json(receipts);
});

router.get("/spending", async (_req, res) => {
  const spending = await receiptService.getWeeklySpending();
  res.json(spending);
});

router.get("/:id", async (req, res) => {
  const receipt = await receiptService.getReceiptById(Number(req.params.id));
  if (!receipt) return res.status(404).json({ error: "Receipt not found" });
  res.json(receipt);
});

router.delete("/:id", async (req, res) => {
  await receiptService.deleteReceipt(Number(req.params.id));
  res.status(204).send();
});

export default router;
