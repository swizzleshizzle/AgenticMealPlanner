import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import * as plannerService from "../services/plannerService.js";
import { deductIngredientsForMeal } from "../services/pantryService.js";
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

router.post("/:id/generate", async (req, res) => {
  const planId = Number(req.params.id);
  const plan = await plannerService.getPlanById(planId);
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  const allMeals = await prisma.meal.findMany({
    select: { id: true, name: true, mealType: true, tags: true, servings: true, calories: true },
  });

  const pantryItems = await prisma.pantryItem.findMany({
    include: { ingredient: true },
  });
  const pantry = pantryItems.map((p) => ({
    name: p.ingredient.name,
    quantity: p.quantity,
    unit: p.unit,
  }));

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const recentPlans = await prisma.plannedMeal.findMany({
    where: { plan: { weekStartDate: { gte: twoWeeksAgo } } },
    select: { mealId: true },
  });
  const recentMealIds = [...new Set(recentPlans.map((p) => p.mealId))];

  try {
    const suggested = await generateWeeklyPlan(allMeals, pantry, recentMealIds);

    for (const meal of suggested.meals) {
      await plannerService.addPlannedMeal(planId, {
        mealId: meal.mealId,
        day: meal.day,
        mealSlot: meal.mealSlot,
        servings: meal.servings,
        isPrep: meal.isPrep,
      });
    }

    const updatedPlan = await plannerService.getPlanById(planId);
    res.json(updatedPlan);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate plan", details: err.message });
  }
});

export default router;
