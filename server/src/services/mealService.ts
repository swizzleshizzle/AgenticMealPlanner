import { PrismaClient } from "@prisma/client";
import { copyFile, unlink } from "fs/promises";
import { ensureMealDir, mealThumbPath, relStoragePath } from "./mediaStorage.js";

const prisma = new PrismaClient();

const mealWithIngredients = {
  ingredients: {
    include: { ingredient: true },
  },
};

export async function getAllMeals() {
  return prisma.meal.findMany({
    include: mealWithIngredients,
    orderBy: { name: "asc" },
  });
}

export async function getMealById(id: number) {
  return prisma.meal.findUnique({
    where: { id },
    include: mealWithIngredients,
  });
}

interface IngredientInput {
  ingredientId: number;
  quantity: number;
  unit: string;
  preparation?: string;
}

interface CreateMealInput {
  name: string;
  description?: string;
  source?: "hello_fresh" | "manual";
  sourceUrl?: string;
  mealType: "batch_prep" | "cook_fresh";
  servings: number;
  prepTime?: number;
  cookTime?: number;
  tags?: string[];
  instructions: string[];
  imageUrl?: string;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  sodiumMg?: number;
  ingredients?: IngredientInput[];
}

export async function createMeal(data: CreateMealInput) {
  const { ingredients, instructions, ...mealData } = data;

  return prisma.meal.create({
    data: {
      ...mealData,
      instructions: JSON.stringify(instructions),
      ingredients: ingredients
        ? {
            create: ingredients.map((ing) => ({
              ingredientId: ing.ingredientId,
              quantity: ing.quantity,
              unit: ing.unit,
              preparation: ing.preparation,
            })),
          }
        : undefined,
    },
    include: mealWithIngredients,
  });
}

export async function updateMeal(id: number, data: Partial<CreateMealInput>) {
  const { ingredients, instructions, ...mealData } = data;

  const updateData: any = { ...mealData };
  if (instructions) {
    updateData.instructions = JSON.stringify(instructions);
  }

  if (ingredients) {
    await prisma.mealIngredient.deleteMany({ where: { mealId: id } });
    await prisma.mealIngredient.createMany({
      data: ingredients.map((ing) => ({
        mealId: id,
        ingredientId: ing.ingredientId,
        quantity: ing.quantity,
        unit: ing.unit,
        preparation: ing.preparation,
      })),
    });
  }

  return prisma.meal.update({
    where: { id },
    data: updateData,
    include: mealWithIngredients,
  });
}

export async function deleteMeal(id: number) {
  return prisma.meal.delete({ where: { id } });
}

export async function replaceMealPhoto(mealId: number, tmpPath: string) {
  await ensureMealDir(mealId);
  const dest = mealThumbPath(mealId);
  await copyFile(tmpPath, dest);
  try { await unlink(tmpPath); } catch {}
  return prisma.meal.update({
    where: { id: mealId },
    data: { imagePath: relStoragePath(dest), imageSource: "manual" },
  });
}
