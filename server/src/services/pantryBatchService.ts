import { Prisma, type PantryLocation } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { convert, UnitConversionError, unitsPerContainerFor } from "../lib/units.js";

export interface CreateBatchInput {
  ingredientId?: number;
  newIngredient?: {
    name: string;
    category: string;
    defaultUnit: string;
    defaultLocation?: PantryLocation;
    densityGPerMl?: number | null;
    gramsPerCount?: number | null;
    shelfLifeFridgeDays?: number | null;
    shelfLifeFreezerDays?: number | null;
    shelfLifePantryDays?: number | null;
    lowStockThreshold?: number | null;
    lowStockUnit?: string | null;
    isOneOff?: boolean;
  };
  quantity: number;
  unit: string;
  location: PantryLocation;
  expirationDate?: string | null;
  purchaseDate?: string | null;
  costAtPurchase?: number | null;
  tags?: string[];
  receiptItemId?: number | null;
}

export async function createBatch(input: CreateBatchInput) {
  return prisma.$transaction(async (tx) => {
    let ingredientId = input.ingredientId;
    if (!ingredientId) {
      if (!input.newIngredient) {
        throw new Error("Either ingredientId or newIngredient is required");
      }
      const created = await tx.ingredient.upsert({
        where: { name: input.newIngredient.name.toLowerCase() },
        update: {},
        create: {
          name: input.newIngredient.name.toLowerCase(),
          category: input.newIngredient.category as any,
          defaultUnit: input.newIngredient.defaultUnit,
          defaultLocation: input.newIngredient.defaultLocation ?? null,
          densityGPerMl: input.newIngredient.densityGPerMl ?? null,
          gramsPerCount: input.newIngredient.gramsPerCount ?? null,
          shelfLifeFridgeDays: input.newIngredient.shelfLifeFridgeDays ?? null,
          shelfLifeFreezerDays: input.newIngredient.shelfLifeFreezerDays ?? null,
          shelfLifePantryDays: input.newIngredient.shelfLifePantryDays ?? null,
          lowStockThreshold: input.newIngredient.lowStockThreshold ?? null,
          lowStockUnit: input.newIngredient.lowStockUnit ?? null,
          isOneOff: input.newIngredient.isOneOff ?? false,
        },
      });
      ingredientId = created.id;
    }

    return tx.pantryBatch.create({
      data: {
        ingredientId,
        quantity: input.quantity,
        unit: input.unit,
        location: input.location,
        expirationDate: input.expirationDate ? new Date(input.expirationDate) : null,
        purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : null,
        costAtPurchase: input.costAtPurchase != null ? new Prisma.Decimal(input.costAtPurchase) : null,
        tags: input.tags ?? [],
        receiptItemId: input.receiptItemId ?? null,
      },
      include: { ingredient: true },
    });
  });
}

export interface SuggestExpirationInput {
  tripDate: Date;
  location: PantryLocation;
  ingredient: {
    shelfLifeFridgeDays: number | null;
    shelfLifeFreezerDays: number | null;
    shelfLifePantryDays: number | null;
  };
}

export function suggestExpirationDate(input: SuggestExpirationInput): Date | null {
  const days =
    input.location === "fridge" ? input.ingredient.shelfLifeFridgeDays
    : input.location === "freezer" ? input.ingredient.shelfLifeFreezerDays
    : input.ingredient.shelfLifePantryDays;
  if (days == null) return null;
  return new Date(input.tripDate.getTime() + days * 24 * 60 * 60 * 1000);
}

export interface UpdateBatchInput {
  quantity?: number;
  unit?: string;
  location?: PantryLocation;
  expirationDate?: string | null;
  purchaseDate?: string | null;
  costAtPurchase?: number | null;
  tags?: string[];
}

export async function updateBatch(id: number, input: UpdateBatchInput) {
  const data: any = {};
  if (input.quantity != null) data.quantity = Math.max(0, input.quantity);
  if (input.unit != null) data.unit = input.unit;
  if (input.location != null) data.location = input.location;
  if (input.expirationDate !== undefined) data.expirationDate = input.expirationDate ? new Date(input.expirationDate) : null;
  if (input.purchaseDate !== undefined) data.purchaseDate = input.purchaseDate ? new Date(input.purchaseDate) : null;
  if (input.costAtPurchase !== undefined) data.costAtPurchase = input.costAtPurchase != null ? new Prisma.Decimal(input.costAtPurchase) : null;
  if (input.tags != null) data.tags = input.tags;

  // If quantity drops to 0, soft-delete instead.
  if (data.quantity === 0) {
    return prisma.pantryBatch.update({
      where: { id },
      data: { ...data, consumedAt: new Date() },
      include: { ingredient: true },
    });
  }

  return prisma.pantryBatch.update({
    where: { id },
    data,
    include: { ingredient: true },
  });
}

const RESTORE_WINDOW_DAYS = 30;

export async function softDeleteBatch(id: number) {
  return prisma.pantryBatch.update({
    where: { id },
    data: { consumedAt: new Date() },
    include: { ingredient: true },
  });
}

export async function restoreBatch(id: number) {
  const batch = await prisma.pantryBatch.findUnique({ where: { id } });
  if (!batch || !batch.consumedAt) return null;
  const ageMs = Date.now() - batch.consumedAt.getTime();
  if (ageMs > RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000) return null;
  return prisma.pantryBatch.update({
    where: { id },
    data: { consumedAt: null },
    include: { ingredient: true },
  });
}

export async function hardDeleteBatch(id: number) {
  const deleted = await prisma.pantryBatch.delete({ where: { id } });
  return { id: deleted.id };
}

export interface NormalizeResult {
  normalized: Array<{ batchId: number; fromUnit: string; toQuantity: number; toUnit: string }>;
  skipped: Array<{ batchId: number; unit: string; reason: string }>;
}

// Convert every active batch of an ingredient to its default unit, using the
// same conversion hints the rest of the app uses. Unconvertible batches are
// left untouched and reported — never guessed. Fixes the mixed-unit batch
// sets (mayo in oz AND fl oz) that every downstream conversion headache
// feeds on.
export async function normalizeBatches(ingredientId: number): Promise<NormalizeResult> {
  const ingredient = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ingredient) throw new Error(`Unknown ingredientId: ${ingredientId}`);

  const target = ingredient.defaultUnit;
  const hint = {
    densityGPerMl: ingredient.densityGPerMl,
    gramsPerCount: ingredient.gramsPerCount,
    unitsPerContainer: unitsPerContainerFor(ingredient),
  };
  const batches = await prisma.pantryBatch.findMany({
    where: { ingredientId, consumedAt: null },
  });

  const result: NormalizeResult = { normalized: [], skipped: [] };
  const updates: Array<{ id: number; quantity: number }> = [];
  for (const b of batches) {
    if (b.unit === target) continue;
    try {
      // Round at write time so normalization never introduces float dust.
      const quantity = Math.round(convert(b.quantity, b.unit, target, hint) * 1e4) / 1e4;
      updates.push({ id: b.id, quantity });
      result.normalized.push({ batchId: b.id, fromUnit: b.unit, toQuantity: quantity, toUnit: target });
    } catch (e) {
      if (e instanceof UnitConversionError) {
        result.skipped.push({ batchId: b.id, unit: b.unit, reason: e.missing });
      } else {
        throw e;
      }
    }
  }

  await prisma.$transaction(
    updates.map((u) =>
      prisma.pantryBatch.update({ where: { id: u.id }, data: { quantity: u.quantity, unit: target } }),
    ),
  );
  return result;
}
