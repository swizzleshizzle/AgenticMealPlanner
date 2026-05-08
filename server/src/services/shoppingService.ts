import { PrismaClient } from "@prisma/client";
import { aggregateCards } from "./pantryAggregation.js";

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

  const plannedMeals = await prisma.plannedMeal.findMany({
    where: {
      planId,
      status: { in: ["planned", "cooked"] },
      cookStyle: { not: "leftovers" },
    },
    include: { meal: { include: { ingredients: true } } },
  });

  const pantryItems = await prisma.pantryBatch.findMany();

  const aggregated = aggregateShoppingItems({
    plannedMeals: plannedMeals.map((pm) => ({
      cookStyle: pm.cookStyle,
      servings: pm.servings,
      meal: {
        servings: pm.meal.servings,
        ingredients: pm.meal.ingredients.map((mi) => ({
          ingredientId: mi.ingredientId,
          quantity: mi.quantity,
          unit: mi.unit,
        })),
      },
    })),
    pantryItems: pantryItems.map((p) => ({
      ingredientId: p.ingredientId,
      quantity: p.quantity,
    })),
  });

  await prisma.shoppingItem.createMany({
    data: aggregated.map((a) => ({
      planId,
      ingredientId: a.ingredientId,
      quantityNeeded: a.quantityNeeded,
      quantityOnHand: a.quantityOnHand,
      quantityToBuy: a.quantityToBuy,
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
