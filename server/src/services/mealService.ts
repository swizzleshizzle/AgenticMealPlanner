import { PrismaClient } from "@prisma/client";
import { copyFile, unlink } from "fs/promises";
import path from "path";
import { ensureMealDir, mealThumbPath, mealPdfPath, relStoragePath } from "./mediaStorage.js";
import { runThumbnailJob } from "./pdfExtraction.js";

const prisma = new PrismaClient();

const mealWithIngredients = {
  ingredients: {
    include: { ingredient: true },
  },
};

export async function getAllMeals() {
  const rows = await prisma.meal.findMany({
    where: { isDefault: true, archivedAt: null },
    include: mealWithIngredients,
    orderBy: { name: "asc" },
  });

  // Annotate each row with a count of *active* variants in its family.
  const recipeIds = rows.map((r) => r.recipeId);
  const variantCounts = await prisma.meal.groupBy({
    by: ["recipeId"],
    where: { recipeId: { in: recipeIds }, archivedAt: null },
    _count: { _all: true },
  });
  const countByRecipe = new Map(variantCounts.map((g) => [g.recipeId, g._count._all]));

  return rows.map((r) => ({ ...r, variantCount: countByRecipe.get(r.recipeId) ?? 1 }));
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
  canBatch?: boolean;
  canFresh?: boolean;
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

interface CapabilityInput { canBatch?: boolean; canFresh?: boolean }
interface ExistingCapability { canBatch: boolean; canFresh: boolean }
interface ResolvedCapability {
  canBatch: boolean;
  canFresh: boolean;
}

/**
 * Resolves the capability write for create/update. For create, pass
 * existing=null; missing flags default to canFresh=true, canBatch=false. For
 * update, pass the current row; missing flags inherit from it, and if
 * neither flag is present in the patch the function returns null (no write).
 */
export function resolveCapabilityWrite(
  input: CapabilityInput,
  existing: ExistingCapability | null,
): ResolvedCapability | null {
  if (existing && input.canBatch === undefined && input.canFresh === undefined) {
    return null;
  }
  const canFresh = input.canFresh ?? existing?.canFresh ?? true;
  const canBatch = input.canBatch ?? existing?.canBatch ?? false;
  return { canBatch, canFresh };
}

export async function createMeal(data: CreateMealInput) {
  const { ingredients, instructions, canBatch, canFresh, ...rest } = data;
  const capability = resolveCapabilityWrite({ canBatch, canFresh }, null)!;

  return prisma.$transaction(async (tx) => {
    const created = await tx.meal.create({
      data: {
        ...rest,
        ...capability,
        instructions: JSON.stringify(instructions),
        recipeId: 0, // overwritten below; non-null required.
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

    return tx.meal.update({
      where: { id: created.id },
      data: { recipeId: created.id },
      include: mealWithIngredients,
    });
  });
}

export async function updateMeal(id: number, data: Partial<CreateMealInput>) {
  const { ingredients, instructions, canBatch, canFresh, ...rest } = data;

  const updateData: any = { ...rest };
  if (instructions) {
    updateData.instructions = JSON.stringify(instructions);
  }

  if (canBatch !== undefined || canFresh !== undefined) {
    const existing = await prisma.meal.findUniqueOrThrow({
      where: { id },
      select: { canBatch: true, canFresh: true },
    });
    const capability = resolveCapabilityWrite({ canBatch, canFresh }, existing);
    if (capability) Object.assign(updateData, capability);
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
    include: mealWithIngredients,
  });
}

export async function uploadMealPdf(mealId: number, tmpPath: string) {
  await ensureMealDir(mealId);
  const destPdf = mealPdfPath(mealId);
  await copyFile(tmpPath, destPdf);
  try { await unlink(tmpPath); } catch {}

  const meal = await prisma.meal.findUnique({ where: { id: mealId } });
  const keepManual = meal?.imageSource === "manual";

  let source: "embedded" | "rasterized" | null = null;
  if (!keepManual) {
    source = await runThumbnailJob(destPdf, mealThumbPath(mealId));
  }

  return prisma.meal.update({
    where: { id: mealId },
    data: {
      pdfPath: relStoragePath(destPdf),
      ...(keepManual ? {} : {
        imagePath: source ? relStoragePath(mealThumbPath(mealId)) : null,
        imageSource: source,
      }),
    },
    include: mealWithIngredients,
  });
}

export async function extractMealThumbnail(mealId: number, force = false) {
  const meal = await prisma.meal.findUnique({ where: { id: mealId } });
  if (!meal) throw Object.assign(new Error("meal not found"), { status: 404 });
  if (!meal.pdfPath) throw Object.assign(new Error("no PDF for this meal"), { status: 409 });
  if (meal.imageSource === "manual" && !force) {
    throw Object.assign(new Error("photo is manual; pass force=true to overwrite"), { status: 409 });
  }
  const pdfAbs = path.resolve(process.cwd(), meal.pdfPath);
  const thumbAbs = mealThumbPath(mealId);
  const source = await runThumbnailJob(pdfAbs, thumbAbs);
  return prisma.meal.update({
    where: { id: mealId },
    data: { imagePath: source ? relStoragePath(thumbAbs) : null, imageSource: source },
    include: mealWithIngredients,
  });
}
