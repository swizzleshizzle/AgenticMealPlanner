import { Router } from "express";
import { Prisma } from "@prisma/client";
import * as shoppingService from "../services/shoppingService.js";
import { parseId } from "./_validation.js";

const router = Router();

router.post("/generate/:planId", async (req, res) => {
  // Guard the id: generateShoppingList runs a deleteMany on planId first, so a
  // NaN here would issue `deleteMany({ where: { planId: NaN }})`.
  const planId = parseId(req.params.planId, res, "plan id");
  if (planId === null) return;
  const result = await shoppingService.generateShoppingList(planId);
  res.status(201).json(result);
});

router.get("/low-stock", async (_req, res) => {
  const suggestions = await shoppingService.getLowStockSuggestions();
  res.json(suggestions);
});

// Custom items — list before the generic :planId route so /:planId/custom resolves correctly.
router.get("/:planId/custom", async (req, res) => {
  const items = await shoppingService.listCustomShoppingItems(Number(req.params.planId));
  res.json(items);
});

router.post("/:planId/custom", async (req, res) => {
  try {
    const item = await shoppingService.createCustomShoppingItem(
      Number(req.params.planId),
      { name: req.body?.name, qtyText: req.body?.qtyText },
    );
    res.status(201).json(item);
  } catch (e) {
    if (e instanceof shoppingService.CustomShoppingItemValidationError) {
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }
});

router.put("/custom/:id", async (req, res) => {
  try {
    const item = await shoppingService.updateCustomShoppingItem(Number(req.params.id), {
      checked: req.body?.checked,
      name: req.body?.name,
      qtyText: req.body?.qtyText,
    });
    res.json(item);
  } catch (e) {
    if (e instanceof shoppingService.CustomShoppingItemValidationError) {
      res.status(400).json({ error: e.message });
      return;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      res.status(404).json({ error: "Custom shopping item not found" });
      return;
    }
    throw e;
  }
});

router.delete("/custom/:id", async (req, res) => {
  try {
    await shoppingService.deleteCustomShoppingItem(Number(req.params.id));
    res.status(204).end();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      res.status(404).json({ error: "Custom shopping item not found" });
      return;
    }
    throw e;
  }
});

router.get("/:planId", async (req, res) => {
  const planId = parseId(req.params.planId, res, "plan id");
  if (planId === null) return;
  const result = await shoppingService.getShoppingList(planId);
  res.json(result);
});

router.put("/item/:id", async (req, res) => {
  const id = parseId(req.params.id, res, "item id");
  if (id === null) return;
  if (typeof req.body?.checked !== "boolean") {
    res.status(400).json({ error: "checked must be a boolean" });
    return;
  }
  const item = await shoppingService.toggleShoppingItem(id, req.body.checked);
  res.json(item);
});

export default router;
