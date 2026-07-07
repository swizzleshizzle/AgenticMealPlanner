import type { PrismaClient } from "@prisma/client";
import { aggregateCards, type PantryCard } from "./pantryAggregation.js";
import { convert, UnitConversionError } from "../lib/units.js";
import { prisma } from "../lib/prisma.js";

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

export interface DrainPlan {
  consumed: Array<{ batchId: number; partial: boolean; newQuantity: number }>;
  shortfall: number;
  shortfallUnit: string;
}

export function selectBatchesToDrain(input: {
  needed: number;
  neededUnit: string;
  ingredient: { defaultUnit: string; densityGPerMl: number | null; gramsPerCount: number | null };
  batches: Array<{ id: number; quantity: number; unit: string; expirationDate: Date | null; tags: string[] }>;
}): DrainPlan {
  const hint = { densityGPerMl: input.ingredient.densityGPerMl, gramsPerCount: input.ingredient.gramsPerCount };
  // Sort: use_first first, then FEFO ASC, then null-exp last.
  const ordered = input.batches.slice().sort((a, b) => {
    const aFirst = a.tags.includes("use_first") ? 0 : 1;
    const bFirst = b.tags.includes("use_first") ? 0 : 1;
    if (aFirst !== bFirst) return aFirst - bFirst;
    const ae = a.expirationDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const be = b.expirationDate?.getTime() ?? Number.POSITIVE_INFINITY;
    return ae - be;
  });

  let remaining = input.needed; // in input.neededUnit
  const consumed: DrainPlan["consumed"] = [];

  for (const b of ordered) {
    if (remaining <= 0) break;
    // How much of this batch (expressed in neededUnit) is available?
    const batchInNeededUnit = convert(b.quantity, b.unit, input.neededUnit, hint);
    if (batchInNeededUnit <= remaining) {
      // Drain entirely.
      remaining -= batchInNeededUnit;
      consumed.push({ batchId: b.id, partial: false, newQuantity: 0 });
    } else {
      // Partial drain: convert remaining (in neededUnit) back to batch.unit.
      const drainInBatchUnit = convert(remaining, input.neededUnit, b.unit, hint);
      consumed.push({ batchId: b.id, partial: true, newQuantity: b.quantity - drainInBatchUnit });
      remaining = 0;
    }
  }

  return { consumed, shortfall: remaining, shortfallUnit: input.neededUnit };
}

export interface DeductOverride {
  ingredientId: number;
  quantity: number;
  unit: string;
}

export interface DeductShortfall {
  ingredientId: number;
  ingredientName: string;
  requestedQuantity: number;
  requestedUnit: string;
  availableQuantity: number;
  reason: "insufficient" | "no_density" | "no_pantry";
}

export interface DeductResult {
  shortfalls: DeductShortfall[];
}

// Prisma does not export a TransactionClient type publicly. The Parameters<>
// trick captures the interactive-transaction callback's argument type, but
// it loses the model accessor types — hence the `(tx as any).model.method`
// casts in runDeduction below. Keep this localized; do not propagate.
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function deductIngredientsForMeal(
  mealId: number,
  servingMultiplier: number,
  overrides?: DeductOverride[],
  tx?: Tx,
): Promise<DeductResult> {
  if (tx) {
    return runDeduction(tx, mealId, servingMultiplier, overrides);
  }
  return prisma.$transaction((innerTx) =>
    runDeduction(innerTx, mealId, servingMultiplier, overrides),
  );
}

async function runDeduction(
  tx: Tx,
  mealId: number,
  servingMultiplier: number,
  overrides: DeductOverride[] | undefined,
): Promise<DeductResult> {
  let lines: Array<{ ingredientId: number; quantity: number; unit: string }>;
  if (overrides !== undefined) {
    lines = overrides;
  } else {
    const mealIngredients = await (tx as any).mealIngredient.findMany({
      where: { mealId },
    });
    lines = mealIngredients.map((mi: any) => ({
      ingredientId: mi.ingredientId,
      quantity: mi.quantity * servingMultiplier,
      unit: mi.unit,
    }));
  }

  const shortfalls: DeductShortfall[] = [];

  for (const line of lines) {
    const ingredient = await (tx as any).ingredient.findUnique({
      where: { id: line.ingredientId },
    });
    if (!ingredient) {
      throw new Error(`Unknown ingredientId in deduction: ${line.ingredientId}`);
    }

    const batchRows = await (tx as any).pantryBatch.findMany({
      where: { ingredientId: line.ingredientId, consumedAt: null },
    });

    if (batchRows.length === 0) {
      shortfalls.push({
        ingredientId: line.ingredientId,
        ingredientName: ingredient.name,
        requestedQuantity: line.quantity,
        requestedUnit: line.unit,
        availableQuantity: 0,
        reason: "no_pantry",
      });
      continue;
    }

    let plan;
    try {
      plan = selectBatchesToDrain({
        needed: line.quantity,
        neededUnit: line.unit,
        ingredient,
        batches: batchRows.map((b: any) => ({
          id: b.id,
          quantity: b.quantity,
          unit: b.unit,
          expirationDate: b.expirationDate,
          tags: b.tags,
        })),
      });
    } catch (e) {
      if (e instanceof UnitConversionError) {
        shortfalls.push({
          ingredientId: line.ingredientId,
          ingredientName: ingredient.name,
          requestedQuantity: line.quantity,
          requestedUnit: line.unit,
          availableQuantity: 0,
          reason: "no_density",
        });
        continue;
      }
      throw e;
    }

    for (const c of plan.consumed) {
      if (c.partial) {
        await (tx as any).pantryBatch.update({
          where: { id: c.batchId },
          data: { quantity: c.newQuantity },
        });
      } else {
        await (tx as any).pantryBatch.update({
          where: { id: c.batchId },
          data: { quantity: 0, consumedAt: new Date() },
        });
      }
    }

    if (plan.shortfall > 0) {
      // selectBatchesToDrain.shortfallUnit is always the requested unit, so
      // (requested - shortfall) is the amount actually drained, in the same unit.
      const drained = line.quantity - plan.shortfall;
      shortfalls.push({
        ingredientId: line.ingredientId,
        ingredientName: ingredient.name,
        requestedQuantity: line.quantity,
        requestedUnit: line.unit,
        availableQuantity: drained,
        reason: "insufficient",
      });
    }
  }

  return { shortfalls };
}
