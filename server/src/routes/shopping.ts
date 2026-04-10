import { Router } from "express";
import * as shoppingService from "../services/shoppingService.js";

const router = Router();

router.post("/generate/:planId", async (req, res) => {
  const items = await shoppingService.generateShoppingList(Number(req.params.planId));
  res.status(201).json(items);
});

router.get("/:planId", async (req, res) => {
  const items = await shoppingService.getShoppingList(Number(req.params.planId));
  res.json(items);
});

router.put("/item/:id", async (req, res) => {
  const item = await shoppingService.toggleShoppingItem(Number(req.params.id), req.body.checked);
  res.json(item);
});

export default router;
