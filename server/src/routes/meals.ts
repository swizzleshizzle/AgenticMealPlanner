import { Router } from "express";
import * as mealService from "../services/mealService.js";
import { upload, uploadImage, uploadPdfOnly } from "../middleware/upload.js";
import { parseRecipeFromFile } from "../claude/recipeParser.js";
import { stashImportPdf, popImportPdf } from "../services/importSessions.js";
import { resolveIngredientId } from "../services/ingredientResolve.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const router = Router();

router.get("/", async (_req, res) => {
  const meals = await mealService.getAllMeals();
  res.json(meals);
});

router.get("/archived", async (_req, res) => {
  res.json(await mealService.getArchivedMeals());
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
  const { importSessionId, ...mealData } = req.body;
  const meal = await mealService.createMeal(mealData);

  if (importSessionId) {
    const tmpPdf = popImportPdf(importSessionId);
    if (tmpPdf) {
      // Fire-and-forget so the client gets an immediate response.
      // The thumb will appear a moment later; the detail page's <img onError>
      // fallback covers the interim.
      mealService.uploadMealPdf(meal.id, tmpPdf).catch((err) =>
        console.error("[import→create] uploadMealPdf failed", meal.id, err)
      );
    }
  }

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

router.post("/:id/extract-thumbnail", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const force = req.query.force === "true";
    const meal = await mealService.extractMealThumbnail(id, force);
    res.json(meal);
  } catch (e: any) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const parsed = await parseRecipeFromFile(req.file.path);

    const existing = await prisma.ingredient.findMany({ select: { id: true, name: true } });
    const aliasRows = await prisma.ingredientAlias.findMany({ select: { alias: true, ingredientId: true } });
    const aliasMap = new Map(aliasRows.map((a) => [a.alias, a.ingredientId]));

    const ingredientMap = new Map<string, number>();
    for (const ing of parsed.ingredients) {
      const resolved = resolveIngredientId(ing.name, existing, aliasMap);
      let ingredientId: number;
      if (resolved) {
        ingredientId = resolved.id;
      } else {
        const created = await prisma.ingredient.upsert({
          where: { name: ing.name },
          update: {},
          create: {
            name: ing.name,
            category: ing.category as any,
            defaultUnit: ing.unit,
          },
        });
        ingredientId = created.id;
        // so later lines in this same import can match the just-created row
        existing.push({ id: created.id, name: created.name });
      }
      ingredientMap.set(ing.name, ingredientId);
    }

    const importSessionId = stashImportPdf(req.file.path);

    res.json({
      parsed,
      ingredientMap: Object.fromEntries(ingredientMap),
      importSessionId,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to parse recipe", details: err.message });
  }
});

router.get("/:id/family", async (req, res) => {
  const family = await mealService.getFamily(Number(req.params.id));
  res.json(family);
});

router.post("/:id/version", async (req, res) => {
  try {
    const meal = await mealService.supersedeMeal(Number(req.params.id), req.body);
    res.status(201).json(meal);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/variant", async (req, res) => {
  try {
    const meal = await mealService.createVariant(Number(req.params.id), req.body);
    res.status(201).json(meal);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/archive", async (req, res) => {
  try {
    const meal = await mealService.archiveMeal(Number(req.params.id));
    res.json(meal);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/archive-family", async (req, res) => {
  try {
    const result = await mealService.archiveFamily(Number(req.params.id));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/unarchive", async (req, res) => {
  try {
    res.json(await mealService.unarchiveMeal(Number(req.params.id)));
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});

router.post("/:id/set-default", async (req, res) => {
  try {
    res.json(await mealService.setDefault(Number(req.params.id)));
  } catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});

export default router;
