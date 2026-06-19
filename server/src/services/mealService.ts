import { prisma } from "../lib/prisma.js";
import { copyFile, unlink, stat } from "fs/promises";
import path from "path";
import { ensureMealDir, mealThumbPath, mealPdfPath, relStoragePath } from "./mediaStorage.js";
import { runThumbnailJob } from "./pdfExtraction.js";
import { pickNextDefaultAfterArchive } from "./mealVersioning.js";

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

// Copies the photo + PDF (whichever exist) from src to dst. Used when
// creating a new version or variant so the new row has its own self-contained
// storage directory matching the rest of the codebase.
export async function copyMealAssets(srcId: number, dstId: number): Promise<{
  imagePath: string | null;
  imageSource: string | null;
  pdfPath: string | null;
}> {
  const src = await prisma.meal.findUniqueOrThrow({
    where: { id: srcId },
    select: { imagePath: true, imageSource: true, pdfPath: true },
  });

  await ensureMealDir(dstId);
  const out: { imagePath: string | null; imageSource: string | null; pdfPath: string | null } = {
    imagePath: null, imageSource: null, pdfPath: null,
  };

  if (src.imagePath) {
    const srcAbs = path.resolve(process.cwd(), src.imagePath);
    if (await fileExists(srcAbs)) {
      const dstAbs = mealThumbPath(dstId);
      await copyFile(srcAbs, dstAbs);
      out.imagePath = relStoragePath(dstAbs);
      out.imageSource = src.imageSource;
    }
  }

  if (src.pdfPath) {
    const srcAbs = path.resolve(process.cwd(), src.pdfPath);
    if (await fileExists(srcAbs)) {
      const dstAbs = mealPdfPath(dstId);
      await copyFile(srcAbs, dstAbs);
      out.pdfPath = relStoragePath(dstAbs);
    }
  }

  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

export async function supersedeMeal(sourceId: number, data: Partial<CreateMealInput>) {
  const source = await prisma.meal.findUniqueOrThrow({
    where: { id: sourceId },
    include: mealWithIngredients,
  });

  const { ingredients, instructions, canBatch, canFresh, ...rest } = data;
  const capability = resolveCapabilityWrite(
    { canBatch, canFresh },
    { canBatch: source.canBatch, canFresh: source.canFresh },
  ) ?? { canBatch: source.canBatch, canFresh: source.canFresh };

  // instructions may be a parsed array or a JSON string depending on the
  // Prisma runtime; normalise to a plain array before JSON.stringify.
  const sourceInstructions: string[] = Array.isArray(source.instructions)
    ? (source.instructions as string[])
    : JSON.parse(String(source.instructions));

  const created = await prisma.$transaction(async (tx) => {
    // Insert the new version: default=true, parent=source, version+1.
    const inserted = await tx.meal.create({
      data: {
        name:         data.name         ?? source.name,
        description:  data.description  ?? source.description,
        source:       source.source,
        sourceUrl:    data.sourceUrl    ?? source.sourceUrl,
        servings:     data.servings     ?? source.servings,
        prepTime:     data.prepTime     ?? source.prepTime,
        cookTime:     data.cookTime     ?? source.cookTime,
        tags:         data.tags         ?? source.tags,
        instructions: JSON.stringify(instructions ?? sourceInstructions),
        calories:     data.calories     ?? source.calories,
        proteinG:     data.proteinG     ?? source.proteinG,
        carbsG:       data.carbsG       ?? source.carbsG,
        fatG:         data.fatG         ?? source.fatG,
        fiberG:       data.fiberG       ?? source.fiberG,
        sodiumMg:     data.sodiumMg     ?? source.sodiumMg,
        ...capability,
        recipeId:      source.recipeId,
        versionNumber: source.versionNumber + 1,
        parentMealId:  source.id,
        isDefault:     true,
        ingredients: {
          create: (ingredients ?? source.ingredients.map((mi) => ({
            ingredientId: mi.ingredientId,
            quantity:     mi.quantity,
            unit:         mi.unit,
            preparation:  mi.preparation ?? undefined,
          }))).map((ing) => ({
            ingredientId: ing.ingredientId,
            quantity:     ing.quantity,
            unit:         ing.unit,
            preparation:  ing.preparation,
          })),
        },
      },
    });

    // Demote + archive the previous default in the same transaction.
    await tx.meal.update({
      where: { id: source.id },
      data: { isDefault: false, archivedAt: new Date() },
    });

    return inserted;
  });

  // Copy assets after the transaction commits — file IO outside the txn.
  const assetUpdate = await copyMealAssets(sourceId, created.id);
  return prisma.meal.update({
    where: { id: created.id },
    data: assetUpdate,
    include: mealWithIngredients,
  });
}

export async function createVariant(sourceId: number, data: Partial<CreateMealInput>) {
  const source = await prisma.meal.findUniqueOrThrow({
    where: { id: sourceId },
    include: mealWithIngredients,
  });

  const { ingredients, instructions, canBatch, canFresh, ...rest } = data;
  const capability = resolveCapabilityWrite(
    { canBatch, canFresh },
    { canBatch: source.canBatch, canFresh: source.canFresh },
  ) ?? { canBatch: source.canBatch, canFresh: source.canFresh };

  // Normalise instructions the same way supersedeMeal does.
  const sourceInstructions: string[] = Array.isArray(source.instructions)
    ? (source.instructions as string[])
    : JSON.parse(String(source.instructions));

  const created = await prisma.meal.create({
    data: {
      name:         data.name         ?? source.name,
      description:  data.description  ?? source.description,
      source:       source.source,
      sourceUrl:    data.sourceUrl    ?? source.sourceUrl,
      servings:     data.servings     ?? source.servings,
      prepTime:     data.prepTime     ?? source.prepTime,
      cookTime:     data.cookTime     ?? source.cookTime,
      tags:         data.tags         ?? source.tags,
      instructions: JSON.stringify(instructions ?? sourceInstructions),
      calories:     data.calories     ?? source.calories,
      proteinG:     data.proteinG     ?? source.proteinG,
      carbsG:       data.carbsG       ?? source.carbsG,
      fatG:         data.fatG         ?? source.fatG,
      fiberG:       data.fiberG       ?? source.fiberG,
      sodiumMg:     data.sodiumMg     ?? source.sodiumMg,
      ...capability,
      recipeId:      source.recipeId,
      versionNumber: 1,
      parentMealId:  null,
      isDefault:     false,
      ingredients: {
        create: (ingredients ?? source.ingredients.map((mi) => ({
          ingredientId: mi.ingredientId,
          quantity:     mi.quantity,
          unit:         mi.unit,
          preparation:  mi.preparation ?? undefined,
        }))).map((ing) => ({
          ingredientId: ing.ingredientId,
          quantity:     ing.quantity,
          unit:         ing.unit,
          preparation:  ing.preparation,
        })),
      },
    },
  });

  const assetUpdate = await copyMealAssets(sourceId, created.id);
  return prisma.meal.update({
    where: { id: created.id },
    data: assetUpdate,
    include: mealWithIngredients,
  });
}

export async function archiveMeal(id: number) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.meal.findUniqueOrThrow({
      where: { id },
      select: { id: true, recipeId: true, isDefault: true },
    });

    const family = await tx.meal.findMany({
      where: { recipeId: target.recipeId },
      select: { id: true, isDefault: true, archivedAt: true, updatedAt: true },
    });

    const promoteTo = pickNextDefaultAfterArchive(family, id);

    await tx.meal.update({
      where: { id },
      data: { isDefault: false, archivedAt: new Date() },
    });

    if (promoteTo) {
      await tx.meal.update({
        where: { id: promoteTo.id },
        data: { isDefault: true },
      });
    }

    return tx.meal.findUniqueOrThrow({
      where: { id },
      include: mealWithIngredients,
    });
  });
}

export async function unarchiveMeal(id: number) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.meal.findUniqueOrThrow({
      where: { id },
      select: { recipeId: true },
    });
    // If the family has no active default after unarchiving this row,
    // promote this row to default so it surfaces in the recipes list. This
    // covers the "unarchive a row from a fully-archived family" case;
    // otherwise the meal would clear archivedAt but stay invisible because
    // the list filter is (isDefault=true AND archivedAt IS NULL).
    const activeDefault = await tx.meal.findFirst({
      where: {
        recipeId: target.recipeId,
        isDefault: true,
        archivedAt: null,
        NOT: { id },
      },
      select: { id: true },
    });
    return tx.meal.update({
      where: { id },
      data: {
        archivedAt: null,
        ...(activeDefault ? {} : { isDefault: true }),
      },
      include: mealWithIngredients,
    });
  });
}

export async function setDefault(id: number) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.meal.findUniqueOrThrow({
      where: { id },
      select: { id: true, recipeId: true, archivedAt: true },
    });
    if (target.archivedAt !== null) {
      throw Object.assign(new Error("cannot set archived meal as default"), { status: 409 });
    }
    await tx.meal.updateMany({
      where: { recipeId: target.recipeId, isDefault: true, NOT: { id: target.id } },
      data: { isDefault: false },
    });
    return tx.meal.update({
      where: { id: target.id },
      data: { isDefault: true },
      include: mealWithIngredients,
    });
  });
}

// Archives every active row in the family containing the given meal id.
// `id` may be any row in the family; the server resolves to its recipe_id.
export async function archiveFamily(anyMemberId: number) {
  const member = await prisma.meal.findUniqueOrThrow({
    where: { id: anyMemberId },
    select: { recipeId: true },
  });
  const result = await prisma.meal.updateMany({
    where: { recipeId: member.recipeId, archivedAt: null },
    data: { archivedAt: new Date(), isDefault: false },
  });
  return { recipeId: member.recipeId, archivedCount: result.count };
}

// Returns archived rows grouped into "archived families" (families where
// every row is archived) and "archived variants" (archived rows in
// families that still have ≥1 active row).
export async function getArchivedMeals() {
  const archived = await prisma.meal.findMany({
    where: { archivedAt: { not: null } },
    include: mealWithIngredients,
    orderBy: { updatedAt: "desc" },
  });
  if (archived.length === 0) return { archivedFamilies: [], archivedVariants: [] };

  const recipeIds = [...new Set(archived.map((m) => m.recipeId))];
  const activeCounts = await prisma.meal.groupBy({
    by: ["recipeId"],
    where: { recipeId: { in: recipeIds }, archivedAt: null },
    _count: { _all: true },
  });
  const activeByRecipe = new Map(activeCounts.map((g) => [g.recipeId, g._count._all]));

  const archivedFamilies: typeof archived = [];
  const archivedVariants: typeof archived = [];

  // For families with no active rows, surface the most recently archived row
  // as the "family card" representative.
  const seenFamilies = new Set<number>();
  for (const m of archived) {
    const familyHasActive = (activeByRecipe.get(m.recipeId) ?? 0) > 0;
    if (familyHasActive) {
      archivedVariants.push(m);
    } else if (!seenFamilies.has(m.recipeId)) {
      archivedFamilies.push(m);
      seenFamilies.add(m.recipeId);
    }
  }

  return { archivedFamilies, archivedVariants };
}

// Returns the active variants of the family containing the given meal id,
// ordered with the default first then by name. The argument may be any row
// in the family; the server resolves to its recipe_id.
export async function getFamily(anyMemberId: number) {
  const member = await prisma.meal.findUnique({
    where: { id: anyMemberId },
    select: { recipeId: true },
  });
  if (!member) return [];

  return prisma.meal.findMany({
    where: { recipeId: member.recipeId, archivedAt: null },
    include: mealWithIngredients,
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}
