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
