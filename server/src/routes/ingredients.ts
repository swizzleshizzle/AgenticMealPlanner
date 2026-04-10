import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

router.get("/", async (_req, res) => {
  const ingredients = await prisma.ingredient.findMany({
    orderBy: { name: "asc" },
  });
  res.json(ingredients);
});

router.post("/", async (req, res) => {
  const { name, category, defaultUnit } = req.body;
  try {
    const ingredient = await prisma.ingredient.create({
      data: { name, category, defaultUnit },
    });
    res.status(201).json(ingredient);
  } catch (err: any) {
    if (err.code === "P2002") {
      res.status(409).json({ error: "Ingredient already exists" });
      return;
    }
    throw err;
  }
});

export default router;
