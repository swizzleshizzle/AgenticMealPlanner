import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import * as plannerService from "../services/plannerService.js";
import { deductIngredientsForMeal } from "../services/pantryService.js";

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
  const updated = await plannerService.updatePlannedMeal(Number(req.params.mealId), req.body);

  // Auto-deduct pantry when marking as cooked
  if (req.body.status === "cooked") {
    const servingMultiplier = updated.servings / updated.meal.servings;
    await deductIngredientsForMeal(updated.mealId, servingMultiplier);
  }

  res.json(updated);
});

router.delete("/:planId/meals/:mealId", async (req, res) => {
  await plannerService.removePlannedMeal(Number(req.params.mealId));
  res.status(204).send();
});

export default router;
