import { Router } from "express";
import * as mealService from "../services/mealService.js";

const router = Router();

router.get("/", async (_req, res) => {
  const meals = await mealService.getAllMeals();
  res.json(meals);
});

router.get("/:id", async (req, res) => {
  const meal = await mealService.getMealById(Number(req.params.id));
  if (!meal) {
    res.status(404).json({ error: "Meal not found" });
    return;
  }
  res.json(meal);
});

router.post("/", async (req, res) => {
  const meal = await mealService.createMeal(req.body);
  res.status(201).json(meal);
});

router.put("/:id", async (req, res) => {
  const meal = await mealService.updateMeal(Number(req.params.id), req.body);
  res.json(meal);
});

router.delete("/:id", async (req, res) => {
  await mealService.deleteMeal(Number(req.params.id));
  res.status(204).send();
});

export default router;
