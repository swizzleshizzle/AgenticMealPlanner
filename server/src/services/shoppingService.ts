import { PrismaClient } from "@prisma/client";
import { aggregateCards } from "./pantryAggregation.js";
import { resolvePlannedMealForShopping, type VersionRow } from "./mealVersioning.js";

const prisma = new PrismaClient();

export interface AggregateInput {
  plannedMeals: Array<{
    cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
    servings: number;
    meal: {
      servings: number;
      ingredients: Array<{
        ingredientId: number;
        quantity: number;
        unit: string;
      }>;
    };
  }>;
  pantryItems: Array<{
    ingredientId: number;
    quantity: number;
  }>;
}

export interface AggregateOutput {
  ingredientId: number;
  quantityNeeded: number;
  quantityOnHand: number;
  quantityToBuy: number;
}

// Pure aggregation: given planned meals and pantry on-hand quantities, produce
// the per-ingredient totals. Leftovers occurrences are excluded entirely
// (their ingredients were already accounted for by the source batch_prep on
// Sunday). The pantry on-hand is subtracted from the need to compute
// quantityToBuy, clamped at zero.
export function aggregateShoppingItems(input: AggregateInput): AggregateOutput[] {
  const needed = new Map<number, number>();

  for (const pm of input.plannedMeals) {
    if (pm.cookStyle === "leftovers") continue;
    const scaleFactor = pm.servings / pm.meal.servings;
    for (const mi of pm.meal.ingredients) {
      const qty = mi.quantity * scaleFactor;
      needed.set(mi.ingredientId, (needed.get(mi.ingredientId) ?? 0) + qty);
    }
  }

  const onHand = new Map<number, number>();
  for (const item of input.pantryItems) {
    onHand.set(item.ingredientId, (onHand.get(item.ingredientId) ?? 0) + item.quantity);
  }

  const out: AggregateOutput[] = [];
  for (const [ingredientId, quantityNeeded] of needed) {
    const quantityOnHand = onHand.get(ingredientId) ?? 0;
    const quantityToBuy = Math.max(0, quantityNeeded - quantityOnHand);
    out.push({ ingredientId, quantityNeeded, quantityOnHand, quantityToBuy });
  }
  return out;
}

export async function generateShoppingList(planId: number) {
  await prisma.shoppingItem.deleteMany({ where: { planId } });

  // Query ALL non-leftovers PlannedMeals regardless of status — status
  // filtering happens after version resolution so the resolver sees every row.
  const plannedMeals = await prisma.plannedMeal.findMany({
    where: { planId, cookStyle: { not: "leftovers" } },
    select: { id: true, mealId: true, status: true, cookStyle: true, servings: true },
  });

  // Pull every meal that's even potentially relevant to this plan: each
  // PlannedMeal's row plus every other row sharing its recipeId so the
  // resolver can pick "current default."
  const referencedIds = [...new Set(plannedMeals.map((pm) => pm.mealId))];
  const referencedMeals = await prisma.meal.findMany({
    where: { id: { in: referencedIds } },
    select: { id: true, recipeId: true },
  });
  const recipeIds = [...new Set(referencedMeals.map((m) => m.recipeId))];

  const allFamilyMeals = await prisma.meal.findMany({
    where: { recipeId: { in: recipeIds } },
    include: { ingredients: true },
  });

  const versionRows: (VersionRow & {
    servings: number;
    ingredients: { ingredientId: number; quantity: number; unit: string }[];
  })[] = allFamilyMeals.map((m) => ({
    id: m.id,
    recipeId: m.recipeId,
    isDefault: m.isDefault,
    archivedAt: m.archivedAt,
    servings: m.servings,
    ingredients: m.ingredients.map((mi) => ({
      ingredientId: mi.ingredientId,
      quantity: mi.quantity,
      unit: mi.unit,
    })),
  }));

  // Resolve each PlannedMeal to the right version per the spec:
  // - planned  → floats to the family's current active default
  // - cooked / skipped / swapped → freeze to the referenced row
  // Carry status through so we can filter after flatMap (avoids index misalignment).
  const aggregateInput = plannedMeals.flatMap((pm) => {
    const resolved = resolvePlannedMealForShopping(
      { mealId: pm.mealId, status: pm.status as "planned" | "cooked" | "skipped" | "swapped" },
      versionRows,
    );
    if (!resolved) return [];
    const row = versionRows.find((r) => r.id === resolved.id)!;
    return [{
      status: pm.status,
      cookStyle: pm.cookStyle as "cook_fresh" | "batch_prep" | "leftovers",
      servings: pm.servings,
      meal: { servings: row.servings, ingredients: row.ingredients },
    }];
  });

  // Status filter mirrors prior behavior: planned + cooked contribute to the
  // shopping list; skipped + swapped do not.
  // Status is stripped from the shape before passing to aggregateShoppingItems.
  const statusFilteredInput = aggregateInput
    .filter((entry) => entry.status === "planned" || entry.status === "cooked")
    .map(({ status: _omit, ...rest }) => rest);

  const pantryItems = await prisma.pantryBatch.findMany({ where: { consumedAt: null } });

  const aggregated = aggregateShoppingItems({
    plannedMeals: statusFilteredInput,
    pantryItems: pantryItems.map((p) => ({ ingredientId: p.ingredientId, quantity: p.quantity })),
  });

  await prisma.shoppingItem.createMany({
    data: aggregated.map((a) => ({
      planId,
      ingredientId:   a.ingredientId,
      quantityNeeded: a.quantityNeeded,
      quantityOnHand: a.quantityOnHand,
      quantityToBuy:  a.quantityToBuy,
    })),
  });

  return prisma.shoppingItem.findMany({
    where: { planId },
    include: { ingredient: true },
    orderBy: { ingredient: { category: "asc" } },
  });
}

export async function getShoppingList(planId: number) {
  return prisma.shoppingItem.findMany({
    where: { planId },
    include: { ingredient: true },
    orderBy: { ingredient: { category: "asc" } },
  });
}

export async function toggleShoppingItem(id: number, checked: boolean) {
  return prisma.shoppingItem.update({
    where: { id },
    data: { checked },
    include: { ingredient: true },
  });
}

export async function getLowStockSuggestions() {
  const [ingredientRows, batchRows] = await Promise.all([
    prisma.ingredient.findMany({ where: { isOneOff: false } }),
    prisma.pantryBatch.findMany({ where: { consumedAt: null } }),
  ]);
  const cards = aggregateCards({ ingredients: ingredientRows, batches: batchRows });
  return cards
    .filter((c) => c.isLowStock)
    .map((c) => ({
      ingredientId: c.ingredient.id,
      name: c.ingredient.name,
      currentQty: c.canonicalTotal?.qty ?? 0,
      currentUnit: c.canonicalTotal?.unit ?? c.ingredient.defaultUnit,
      threshold: c.ingredient.lowStockThreshold,
      thresholdUnit: c.ingredient.lowStockUnit,
    }));
}

export class CustomShoppingItemValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomShoppingItemValidationError";
  }
}

const MAX_NAME = 200;
const MAX_QTY_TEXT = 50;

function normalizeName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new CustomShoppingItemValidationError("name must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new CustomShoppingItemValidationError("name must not be empty");
  }
  if (trimmed.length > MAX_NAME) {
    throw new CustomShoppingItemValidationError(`name must be ${MAX_NAME} chars or fewer`);
  }
  return trimmed;
}

function normalizeQtyText(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new CustomShoppingItemValidationError("qtyText must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_QTY_TEXT) {
    throw new CustomShoppingItemValidationError(`qtyText must be ${MAX_QTY_TEXT} chars or fewer`);
  }
  return trimmed;
}

export async function listCustomShoppingItems(planId: number) {
  return prisma.customShoppingItem.findMany({
    where: { planId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createCustomShoppingItem(
  planId: number,
  input: { name: unknown; qtyText?: unknown },
) {
  const name = normalizeName(input.name);
  const qtyText = normalizeQtyText(input.qtyText);
  return prisma.customShoppingItem.create({
    data: { planId, name, qtyText },
  });
}

export async function updateCustomShoppingItem(
  id: number,
  patch: { checked?: unknown; name?: unknown; qtyText?: unknown },
) {
  const data: { checked?: boolean; name?: string; qtyText?: string | null } = {};

  if (patch.checked !== undefined) {
    if (typeof patch.checked !== "boolean") {
      throw new CustomShoppingItemValidationError("checked must be a boolean");
    }
    data.checked = patch.checked;
  }
  if (patch.name !== undefined) {
    data.name = normalizeName(patch.name);
  }
  if (patch.qtyText !== undefined) {
    data.qtyText = normalizeQtyText(patch.qtyText);
  }

  return prisma.customShoppingItem.update({ where: { id }, data });
}

export async function deleteCustomShoppingItem(id: number) {
  await prisma.customShoppingItem.delete({ where: { id } });
}
