import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import * as plannerService from "../services/plannerService.js";
import { deductIngredientsForMeal, type DeductResult } from "../services/pantryService.js";
import { generateWeeklyPlan } from "../claude/mealPlanner.js";

const router = Router();
const prisma = new PrismaClient();

router.get("/", async (_req, res) => {
  const plans = await plannerService.getAllPlans();
  res.json(plans);
});

router.get("/:id", async (req, res) => {
  const plan = await plannerService.getPlanById(Number(req.params.id));
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  res.json(plan);
});

router.post("/", async (req, res) => {
  const plan = await plannerService.createPlan(req.body.weekStartDate);
  res.status(201).json(plan);
});

router.put("/:id", async (req, res) => {
  const plan = await plannerService.updatePlan(Number(req.params.id), req.body);
  res.json(plan);
});

router.post("/:id/meals", async (req, res) => {
  const planned = await plannerService.addPlannedMeal(Number(req.params.id), req.body);
  res.status(201).json(planned);
});

router.put("/:planId/meals/:mealId", async (req, res) => {
  const mealId = Number(req.params.mealId);
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
    const ids = overrides.map((o: any) => o.ingredientId);
    if (new Set(ids).size !== ids.length) {
      res.status(400).json({ error: "duplicate ingredientId in overrides" });
      return;
    }
    const found = await prisma.ingredient.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
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

router.delete("/:planId/meals/:mealId", async (req, res) => {
  await plannerService.removePlannedMeal(Number(req.params.mealId));
  res.status(204).send();
});

router.post("/:id/generate", async (req, res) => {
  const planId = Number(req.params.id);
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
