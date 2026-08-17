import { convert, UnitConversionError } from "../lib/units.js";

export interface AggregateCardsInput {
  ingredients: Array<{
    id: number;
    name: string;
    category: string;
    defaultUnit: string;
    defaultLocation: "fridge" | "freezer" | "pantry" | null;
    densityGPerMl: number | null;
    gramsPerCount: number | null;
    shelfLifeFridgeDays: number | null;
    shelfLifeFreezerDays: number | null;
    shelfLifePantryDays: number | null;
    lowStockThreshold: number | null;
    lowStockUnit: string | null;
    isOneOff: boolean;
    purchaseUnitName?: string | null;
    purchaseUnitQty?: number | null;
  }>;
  batches: Array<{
    id: number;
    ingredientId: number;
    quantity: number;
    unit: string;
    location: "fridge" | "freezer" | "pantry";
    expirationDate: Date | null;
    purchaseDate: Date | null;
    costAtPurchase: unknown; // Decimal | null
    tags: string[];
    receiptItemId: number | null;
    consumedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface PantryCard {
  ingredient: AggregateCardsInput["ingredients"][number];
  batches: AggregateCardsInput["batches"];
  totalsByUnit: Array<{ unit: string; qty: number }>;
  canonicalTotal: { qty: number; unit: string } | null;
  partialTotal: boolean;
  soonestExpiration: Date | null;
  nextExpirationDays: number | null;
  isLowStock: boolean;
  batchCount: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function fefoCompare(
  a: AggregateCardsInput["batches"][number],
  b: AggregateCardsInput["batches"][number],
): number {
  const aFirst = a.tags.includes("use_first") ? 0 : 1;
  const bFirst = b.tags.includes("use_first") ? 0 : 1;
  if (aFirst !== bFirst) return aFirst - bFirst;
  // Earlier expirationDate first; null exp goes to the end.
  const ae = a.expirationDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const be = b.expirationDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return ae - be;
}

export function aggregateCards(input: AggregateCardsInput): PantryCard[] {
  const byIngredient = new Map<number, AggregateCardsInput["batches"]>();
  for (const b of input.batches) {
    if (b.consumedAt != null) continue;
    const list = byIngredient.get(b.ingredientId) ?? [];
    list.push(b);
    byIngredient.set(b.ingredientId, list);
  }

  return input.ingredients.map((ingredient) => {
    const batches = (byIngredient.get(ingredient.id) ?? []).slice().sort(fefoCompare);

    const totals = new Map<string, number>();
    for (const b of batches) {
      totals.set(b.unit, (totals.get(b.unit) ?? 0) + b.quantity);
    }
    const totalsByUnit = Array.from(totals.entries()).map(([unit, qty]) => ({ unit, qty }));

    let canonicalQty = 0;
    let partial = false;
    for (const b of batches) {
      try {
        canonicalQty += convert(b.quantity, b.unit, ingredient.defaultUnit, {
          densityGPerMl: ingredient.densityGPerMl,
          gramsPerCount: ingredient.gramsPerCount,
        });
      } catch (e) {
        if (e instanceof UnitConversionError) {
          partial = true;
        } else {
          throw e;
        }
      }
    }
    const canonicalTotal = batches.length === 0 ? null : { qty: canonicalQty, unit: ingredient.defaultUnit };

    const soonest = batches
      .map((b) => b.expirationDate)
      .filter((d): d is Date => d != null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const nextExpirationDays = soonest
      ? Math.max(0, Math.ceil((soonest.getTime() - Date.now()) / MS_PER_DAY))
      : null;

    let isLowStock = false;
    if (ingredient.lowStockThreshold != null && ingredient.lowStockUnit != null && canonicalTotal) {
      try {
        const totalInThresholdUnit = convert(
          canonicalTotal.qty,
          canonicalTotal.unit,
          ingredient.lowStockUnit,
          { densityGPerMl: ingredient.densityGPerMl, gramsPerCount: ingredient.gramsPerCount },
        );
        isLowStock = totalInThresholdUnit < ingredient.lowStockThreshold;
      } catch {
        // If we can't convert, don't claim "low" — just skip the signal.
        isLowStock = false;
      }
    }

    return {
      ingredient,
      batches,
      totalsByUnit,
      canonicalTotal,
      partialTotal: partial,
      soonestExpiration: soonest,
      nextExpirationDays,
      isLowStock,
      batchCount: batches.length,
    };
  });
}
