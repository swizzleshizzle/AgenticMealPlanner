import { Router } from "express";
import * as pantryService from "../services/pantryService.js";

const router = Router();

router.get("/", async (_req, res) => {
  const items = await pantryService.getAllPantryItems();
  res.json(items);
});

router.post("/", async (req, res) => {
  const item = await pantryService.addPantryItem(req.body);
  res.status(201).json(item);
});

router.put("/:id", async (req, res) => {
  const item = await pantryService.updatePantryItem(Number(req.params.id), req.body);
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  await pantryService.deletePantryItem(Number(req.params.id));
  res.status(204).send();
});

export default router;
