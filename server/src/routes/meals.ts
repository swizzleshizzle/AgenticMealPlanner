import { Router } from "express";
import * as mealService from "../services/mealService.js";
import { upload, uploadImage, uploadPdfOnly } from "../middleware/upload.js";
import { parseRecipeFromFile } from "../claude/recipeParser.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

router.post("/:id/photo", uploadImage.single("file"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: "missing file" });
    const meal = await mealService.replaceMealPhoto(id, req.file.path);
    res.json(meal);
  } catch (e) { next(e); }
});

router.post("/:id/pdf", uploadPdfOnly.single("file"), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!req.file) return res.status(400).json({ error: "missing file" });
    const meal = await mealService.uploadMealPdf(id, req.file.path);
    res.json(meal);
  } catch (e) { next(e); }
});

router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const parsed = await parseRecipeFromFile(req.file.path);

    const ingredientMap = new Map<string, number>();
    for (const ing of parsed.ingredients) {
      const ingredient = await prisma.ingredient.upsert({
        where: { name: ing.name },
        update: {},
        create: {
          name: ing.name,
          category: ing.category as any,
          defaultUnit: ing.unit,
        },
      });
      ingredientMap.set(ing.name, ingredient.id);
    }

    res.json({
      parsed,
      ingredientMap: Object.fromEntries(ingredientMap),
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to parse recipe", details: err.message });
  }
});

export default router;
