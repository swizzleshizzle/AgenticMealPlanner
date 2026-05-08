import { PrismaClient } from "@prisma/client";
import { aggregateCards, type PantryCard } from "./pantryAggregation.js";

const prisma = new PrismaClient();

export interface PantryQuery {
  location?: "fridge" | "freezer" | "pantry";
  category?: string;
  q?: string;            // free-text search on ingredient.name
  sort?: "name" | "expiring" | "added" | "lowstock";
  showConsumed?: boolean;
  lowOnly?: boolean;
}

export async function getPantryCards(query: PantryQuery = {}): Promise<PantryCard[]> {
  // We pull all ingredients (excluding orphan one-offs with no active batches)
  // and all active batches, then aggregate in memory. Pantry is small.
  const ingredientWhere: any = {};
  if (query.category) ingredientWhere.category = query.category;
  if (query.q) ingredientWhere.name = { contains: query.q, mode: "insensitive" };

  const [ingredientRows, batchRows] = await Promise.all([
    prisma.ingredient.findMany({ where: ingredientWhere }),
    prisma.pantryBatch.findMany({
      where: query.showConsumed ? {} : { consumedAt: null },
    }),
  ]);

  let cards = aggregateCards({
    ingredients: ingredientRows,
    batches: batchRows,
  });

  // Hide ingredients that have no active batches AND aren't one-offs explicitly
  // listed: actually, hide all ingredients with no active batches by default,
  // since those are pantry "ghosts" left over from old receipts. Keep them
  // queryable through ingredients API.
  cards = cards.filter((c) => c.batchCount > 0);

  // Hide one-offs that no longer have active batches (already covered above).
  // Hide one-offs from search results by default — they're personal notes.
  // (No flag needed: one-offs with active batches still surface.)

  if (query.location) {
    cards = cards.filter((c) =>
      c.batches.some((b) => b.location === query.location),
    );
  }

  if (query.lowOnly) {
    cards = cards.filter((c) => c.isLowStock);
  }

  switch (query.sort ?? "name") {
    case "expiring":
      cards.sort((a, b) => {
        const ae = a.soonestExpiration?.getTime() ?? Number.POSITIVE_INFINITY;
        const be = b.soonestExpiration?.getTime() ?? Number.POSITIVE_INFINITY;
        return ae - be;
      });
      break;
    case "added":
      cards.sort((a, b) => {
        const aLatest = Math.max(...a.batches.map((x) => x.createdAt.getTime()), 0);
        const bLatest = Math.max(...b.batches.map((x) => x.createdAt.getTime()), 0);
        return bLatest - aLatest;
      });
      break;
    case "lowstock":
      cards.sort((a, b) => Number(b.isLowStock) - Number(a.isLowStock));
      break;
    case "name":
    default:
      cards.sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
      break;
  }

  return cards;
}

export async function addPantryItem(data: {
  ingredientId: number;
  quantity: number;
  unit: string;
  location: "fridge" | "freezer" | "pantry";
  expirationDate?: string;
}) {
  return prisma.pantryBatch.create({
    data: {
      ingredientId: data.ingredientId,
      quantity: data.quantity,
      unit: data.unit,
      location: data.location,
      expirationDate: data.expirationDate ? new Date(data.expirationDate) : undefined,
    },
    include: { ingredient: true },
  });
}

export async function updatePantryItem(id: number, data: { quantity?: number; location?: "fridge" | "freezer" | "pantry" }) {
  return prisma.pantryBatch.update({
    where: { id },
    data,
    include: { ingredient: true },
  });
}

export async function deletePantryItem(id: number) {
  return prisma.pantryBatch.delete({ where: { id } });
}

export async function deductIngredientsForMeal(mealId: number, servingMultiplier: number) {
  const mealIngredients = await prisma.mealIngredient.findMany({
    where: { mealId },
  });

  for (const mi of mealIngredients) {
    const needed = mi.quantity * servingMultiplier;
    const pantryItems = await prisma.pantryBatch.findMany({
      where: { ingredientId: mi.ingredientId },
      orderBy: { expirationDate: "asc" },
    });

    let remaining = needed;
    for (const item of pantryItems) {
      if (remaining <= 0) break;
      if (item.quantity <= remaining) {
        remaining -= item.quantity;
        await prisma.pantryBatch.delete({ where: { id: item.id } });
      } else {
        await prisma.pantryBatch.update({
          where: { id: item.id },
          data: { quantity: item.quantity - remaining },
        });
        remaining = 0;
      }
    }
  }
}
