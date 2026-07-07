import { Router } from "express";
import * as plannerService from "../services/plannerService.js";
import { deductIngredientsForMeal, getPantryCards, type DeductResult } from "../services/pantryService.js";
import { buildCookPreview, type PantryCardLite, type CookPreviewInputLine } from "../services/cookPreview.js";
import { generateWeeklyPlan } from "../claude/mealPlanner.js";
import { prisma } from "../lib/prisma.js";
import { parseId } from "./_validation.js";

const router = Router();

router.get("/", async (_req, res) => {
  const plans = await plannerService.getAllPlans();
  res.json(plans);
});

router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id, res, "plan id");
  if (id === null) return;
  const plan = await plannerService.getPlanById(id);
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  res.json(plan);
});

router.post("/", async (req, res) => {
  const weekStartDate = req.body?.weekStartDate;
  if (typeof weekStartDate !== "string" || Number.isNaN(Date.parse(weekStartDate))) {
    res.status(400).json({ error: "weekStartDate must be a valid date string" });
    return;
  }
  const plan = await plannerService.createPlan(weekStartDate);
  res.status(201).json(plan);
});

router.put("/:id", async (req, res) => {
  const id = parseId(req.params.id, res, "plan id");
  if (id === null) return;
  const plan = await plannerService.updatePlan(id, req.body);
  res.json(plan);
});

router.post("/:id/meals", async (req, res) => {
  const id = parseId(req.params.id, res, "plan id");
  if (id === null) return;
  const planned = await plannerService.addPlannedMeal(id, req.body);
  res.status(201).json(planned);
});

router.put("/:planId/meals/:mealId", async (req, res) => {
  const mealId = parseId(req.params.mealId, res, "meal id");
  if (mealId === null) return;
  const isCooked = req.body.status === "cooked";
  const overrides = req.body.overrides;

  // Reject overrides outside of a cooked transition.
  if (!isCooked && overrides !== undefined) {
    res.status(400).json({ error: "overrides only accepted with status=cooked" });
    return;
  }

  // Validate overrides shape, if present.
  if (isCooked && overrides !== undefined) {
    if (!Array.isArray(overrides)) {
      res.status(400).json({ error: "overrides must be an array" });
      return;
    }
    if (
      !overrides.every(
        (o) =>
          typeof o?.ingredientId === "number" &&
          typeof o?.quantity === "number" &&
          o.quantity > 0 &&
          typeof o?.unit === "string",
      )
    ) {
      res.status(400).json({ error: "invalid override row" });
      return;
    }
    // Duplicate ingredientIds are allowed: re-pointed cook-confirm lines can
    // collapse onto one pantry ingredient, and runDeduction drains them
    // sequentially within a single transaction (compounds correctly).
    const ids = overrides.map((o: any) => o.ingredientId);
    const uniqueIds = [...new Set(ids)];
    const found = await prisma.ingredient.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    if (found.length !== uniqueIds.length) {
      res.status(400).json({ error: "unknown ingredientId in overrides" });
      return;
    }
  }

  // Read current status to detect transition.
  const previous = await prisma.plannedMeal.findUnique({
    where: { id: mealId },
    select: { status: true },
  });
  if (!previous) {
    res.status(404).json({ error: "Planned meal not found" });
    return;
  }
  const isCookTransition = isCooked && previous.status !== "cooked";

  // Strip overrides from the update payload (it isn't a column).
  const { overrides: _stripped, ...updatePayload } = req.body;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await plannerService.updatePlannedMeal(mealId, updatePayload, tx);
    let deduction: DeductResult = { shortfalls: [] };
    if (isCookTransition) {
      const multiplier = updated.servings / updated.meal.servings;
      deduction = await deductIngredientsForMeal(updated.mealId, multiplier, overrides, tx);
    }
    return { updated, deduction };
  });

  res.json({ ...result.updated, deduction: result.deduction });
});

router.post("/:planId/meals/:mealId/cook-preview", async (req, res) => {
  const lines = req.body?.lines;
  if (
    !Array.isArray(lines) ||
    lines.length === 0 ||
    !lines.every(
      (l: any) =>
        typeof l?.ingredientId === "number" &&
        typeof l?.name === "string" &&
        typeof l?.quantity === "number" &&
        typeof l?.unit === "string",
    )
  ) {
    res.status(400).json({ error: "lines must be a non-empty array of {ingredientId,name,quantity,unit}" });
    return;
  }

  const cards = await getPantryCards();
  const lite: PantryCardLite[] = cards.map((c) => ({
    ingredientId: c.ingredient.id,
    name: c.ingredient.name,
    category: c.ingredient.category,
    defaultUnit: c.ingredient.defaultUnit,
    densityGPerMl: c.ingredient.densityGPerMl,
    gramsPerCount: c.ingredient.gramsPerCount,
    batches: c.batches.map((b) => ({
      id: b.id,
      quantity: b.quantity,
      unit: b.unit,
      expirationDate: b.expirationDate,
      tags: b.tags,
    })),
    totalsByUnit: c.totalsByUnit,
  }));

  const aliasRows = await prisma.ingredientAlias.findMany({ select: { alias: true, ingredientId: true } });
  const aliasMap = new Map(aliasRows.map((a) => [a.alias, a.ingredientId]));

  const preview = buildCookPreview(lines as CookPreviewInputLine[], lite, aliasMap);
  res.json({ preview });
});

router.delete("/:planId/meals/:mealId", async (req, res) => {
  const mealId = parseId(req.params.mealId, res, "meal id");
  if (mealId === null) return;
  await plannerService.removePlannedMeal(mealId);
  res.status(204).send();
});

router.post("/:id/generate", async (req, res) => {
  const planId = parseId(req.params.id, res, "plan id");
  if (planId === null) return;
  const plan = await plannerService.getPlanById(planId);
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  try {
    const updatedPlan = await generateWeeklyPlan(planId);
    res.json(updatedPlan);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate plan", details: err.message });
  }
});

export default router;
