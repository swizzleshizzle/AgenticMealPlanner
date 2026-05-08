import { Router } from "express";
import * as pantryService from "../services/pantryService.js";
import * as pantryBatchService from "../services/pantryBatchService.js";

const router = Router();

router.get("/", async (req, res) => {
  const cards = await pantryService.getPantryCards({
    location: req.query.location as any,
    category: req.query.category as any,
    q: req.query.q as string | undefined,
    sort: req.query.sort as any,
    showConsumed: req.query.showConsumed === "true",
    lowOnly: req.query.lowOnly === "true",
  });
  res.json(cards);
});

// Legacy endpoints intentionally removed — replaced by /api/pantry/batches.

router.post("/batches", async (req, res) => {
  try {
    const batch = await pantryBatchService.createBatch(req.body);
    res.status(201).json(batch);
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? "Bad request" });
  }
});

router.patch("/batches/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const batch = await pantryBatchService.updateBatch(id, req.body);
    res.json(batch);
  } catch (e: any) {
    if (e?.code === "P2025") {
      res.status(404).json({ error: "Batch not found" });
      return;
    }
    res.status(400).json({ error: e.message ?? "Bad request" });
  }
});

export default router;
