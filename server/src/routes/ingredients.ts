import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

const FIELDS = [
  "name", "category", "defaultUnit",
  "defaultLocation", "densityGPerMl", "gramsPerCount",
  "shelfLifeFridgeDays", "shelfLifeFreezerDays", "shelfLifePantryDays",
  "lowStockThreshold", "lowStockUnit", "isOneOff",
] as const;

function pickFields(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) out[f] = body[f];
  }
  return out;
}

router.get("/", async (req, res) => {
  const includeOneOffs = req.query.includeOneOffs === "true";
  const ingredients = await prisma.ingredient.findMany({
    where: includeOneOffs ? {} : { isOneOff: false },
    orderBy: { name: "asc" },
  });
  res.json(ingredients);
});

router.post("/", async (req, res) => {
  const data = pickFields(req.body);
  if (typeof data.name === "string") data.name = (data.name as string).toLowerCase();
  try {
    const ingredient = await prisma.ingredient.create({ data: data as any });
    res.status(201).json(ingredient);
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "Ingredient already exists" });
      return;
    }
    throw err;
  }
});

router.post("/aliases", async (req, res) => {
  const { alias, ingredientId } = req.body ?? {};
  if (typeof alias !== "string" || !alias.trim() || typeof ingredientId !== "number") {
    res.status(400).json({ error: "alias (string) and ingredientId (number) required" });
    return;
  }
  const key = alias.trim().toLowerCase();
  const row = await prisma.ingredientAlias.upsert({
    where: { alias: key },
    update: { ingredientId },
    create: { alias: key, ingredientId },
  });
  res.status(201).json(row);
});

router.delete("/aliases/:alias", async (req, res) => {
  const key = req.params.alias.toLowerCase();
  try {
    await prisma.ingredientAlias.delete({ where: { alias: key } });
    res.status(204).send();
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "alias not found" });
      return;
    }
    throw err;
  }
});

router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const data = pickFields(req.body);
  try {
    const ingredient = await prisma.ingredient.update({ where: { id }, data: data as any });
    res.json(ingredient);
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Ingredient not found" });
      return;
    }
    throw err;
  }
});

export default router;
