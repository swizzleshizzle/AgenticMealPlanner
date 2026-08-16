import { aggregateCards } from "./pantryAggregation.js";
import { resolvePlannedMealForShopping, type VersionRow } from "./mealVersioning.js";
import { convert, UnitConversionError, isDescriptorUnit } from "../lib/units.js";
import { prisma } from "../lib/prisma.js";
import { thisWeekSunday } from "../lib/week.js";

export interface IngredientMeta {
  id: number;
  defaultUnit: string;
  densityGPerMl?: number | null;
  gramsPerCount?: number | null;
}

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
    unit: string;
  }>;
  /** Per-ingredient conversion metadata (default unit + density hints). */
  ingredients: IngredientMeta[];
  /**
   * Alias resolution: source ingredientId → canonical ingredientId. Needs and
   * on-hand for a source id pool under the canonical id (e.g. a "chicken
   * cutlet" need is satisfied by "chicken breast" stock).
   */
  canonicalIds?: Map<number, number>;
}

export interface AggregateOutput {
  ingredientId: number;
  /** Unit the quantities below are expressed in (the ingredient's default unit). */
  unit: string;
  quantityNeeded: number;
  quantityOnHand: number;
  quantityToBuy: number;
  /**
   * True when at least one meal-ingredient or pantry batch could not be
   * converted to the ingredient's default unit and was skipped from the totals
   * (so the numbers may understate reality). Surfaced for logging/UI; not
   * persisted (no column exists yet).
   */
  partial: boolean;
}

export interface AggregateResult {
  /** Numeric + estimate rows. Estimate ⇒ quantityNeeded === 0 && partial. */
  items: AggregateOutput[];
  /** Ingredient ids whose only contributions were descriptor units (season-to-taste). */
  staples: number[];
}

// Pure aggregation: given planned meals and pantry on-hand quantities, produce
// the per-ingredient totals — every quantity converted to the ingredient's
// default unit first, so amounts in different units of the same ingredient
// (e.g. a "1 kg" batch against a "2 cup" need) combine correctly instead of
// being summed as bare numbers. Leftovers occurrences are excluded entirely
// (their ingredients were already accounted for by the source batch_prep on
// Sunday). Pantry on-hand is subtracted from the need to compute quantityToBuy,
// clamped at zero. Terms that can't be converted (cross-type without a density
// hint) are skipped and flagged via `partial` rather than mis-summed.
export function aggregateShoppingItems(input: AggregateInput): AggregateResult {
  const metaById = new Map(input.ingredients.map((i) => [i.id, i]));
  const canon = (id: number) => input.canonicalIds?.get(id) ?? id;
  const hintFor = (id: number) => {
    const m = metaById.get(id);
    return { densityGPerMl: m?.densityGPerMl ?? null, gramsPerCount: m?.gramsPerCount ?? null };
  };

  const needed = new Map<number, number>();
  const onHand = new Map<number, number>();
  const partial = new Set<number>();
  const staple = new Set<number>();

  for (const pm of input.plannedMeals) {
    if (pm.cookStyle === "leftovers") continue;
    const scaleFactor = pm.servings / pm.meal.servings;
    for (const mi of pm.meal.ingredients) {
      const id = canon(mi.ingredientId);
      // Non-quantifiable amounts (to taste, pinch, …) never produce a number.
      if (isDescriptorUnit(mi.unit)) {
        staple.add(id);
        continue;
      }
      const target = metaById.get(id)?.defaultUnit ?? mi.unit;
      const raw = mi.quantity * scaleFactor;
      try {
        const q = convert(raw, mi.unit, target, hintFor(id));
        needed.set(id, (needed.get(id) ?? 0) + q);
      } catch (e) {
        if (e instanceof UnitConversionError) {
          partial.add(id);
          // Estimate: keep the ingredient visible with need 0 so the client
          // buckets it under "to buy — couldn't estimate qty". Relies on the
          // invariant that genuine numeric needs are always > 0 (a 0-quantity
          // meal-ingredient would be indistinguishable and render as an estimate).
          if (!needed.has(id)) needed.set(id, 0);
        } else {
          throw e;
        }
      }
    }
  }

  for (const item of input.pantryItems) {
    const id = canon(item.ingredientId);
    if (!needed.has(id)) continue; // only care about needed ingredients
    const target = metaById.get(id)?.defaultUnit ?? item.unit;
    try {
      const q = convert(item.quantity, item.unit, target, hintFor(id));
      onHand.set(id, (onHand.get(id) ?? 0) + q);
    } catch (e) {
      if (e instanceof UnitConversionError) {
        partial.add(id);
      } else {
        throw e;
      }
    }
  }

  const items: AggregateOutput[] = [];
  for (const [ingredientId, quantityNeeded] of needed) {
    const target = metaById.get(ingredientId)?.defaultUnit ?? "";
    const quantityOnHand = onHand.get(ingredientId) ?? 0;
    const quantityToBuy = Math.max(0, quantityNeeded - quantityOnHand);
    items.push({
      ingredientId,
      unit: target,
      quantityNeeded,
      quantityOnHand,
      quantityToBuy,
      partial: partial.has(ingredientId),
    });
  }

  // Descriptor-only ingredients: staple unless they also had a numeric/estimate need.
  const staples = [...staple].filter((id) => !needed.has(id));

  return { items, staples };
}

// Shared compute: resolve planned-meal versions, pull live pantry, aggregate.
// Returns numeric/estimate rows plus descriptor-only staple names. No writes.
async function computeShoppingItems(
  planId: number,
): Promise<{ items: AggregateOutput[]; staples: string[] }> {
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

  // Conversion metadata for every ingredient referenced by a need or an on-hand
  // batch, so aggregation can convert each quantity to the ingredient's unit.
  const involvedIngredientIds = [
    ...new Set([
      ...statusFilteredInput.flatMap((e) => e.meal.ingredients.map((mi) => mi.ingredientId)),
      ...pantryItems.map((p) => p.ingredientId),
    ]),
  ];

  // Alias canonicalization: an involved ingredient whose *name* is an alias of
  // another ingredient (e.g. "chicken cutlet" → "chicken breast") is folded
  // into that target, so its needs and the target's stock pool on one line.
  const involvedNames = await prisma.ingredient.findMany({
    where: { id: { in: involvedIngredientIds } },
    select: { id: true, name: true },
  });
  const aliasRows = await prisma.ingredientAlias.findMany({
    select: { alias: true, ingredientId: true },
  });
  const aliasTargetByName = new Map(aliasRows.map((a) => [a.alias.toLowerCase(), a.ingredientId]));
  const canonicalIds = new Map<number, number>();
  for (const ing of involvedNames) {
    const target = aliasTargetByName.get(ing.name.toLowerCase());
    if (target != null && target !== ing.id) canonicalIds.set(ing.id, target);
  }

  const metaIngredientIds = [...new Set([...involvedIngredientIds, ...canonicalIds.values()])];
  const ingredientMeta = await prisma.ingredient.findMany({
    where: { id: { in: metaIngredientIds } },
    select: { id: true, defaultUnit: true, densityGPerMl: true, gramsPerCount: true },
  });

  const { items, staples: stapleIds } = aggregateShoppingItems({
    plannedMeals: statusFilteredInput,
    pantryItems: pantryItems.map((p) => ({
      ingredientId: p.ingredientId,
      quantity: p.quantity,
      unit: p.unit,
    })),
    ingredients: ingredientMeta,
    canonicalIds,
  });

  const partials = items.filter((a) => a.partial);
  if (partials.length > 0) {
    console.warn(
      `[shopping] plan ${planId}: ${partials.length} ingredient(s) had unconvertible units; ` +
        `shown as estimates (ingredientIds: ${partials.map((p) => p.ingredientId).join(", ")})`,
    );
  }

  const stapleNames = stapleIds.length
    ? (await prisma.ingredient.findMany({
        where: { id: { in: stapleIds } },
        select: { name: true },
        orderBy: { name: "asc" },
      })).map((i) => i.name)
    : [];

  return { items, staples: stapleNames };
}

// Reconcile persisted rows to `items`, preserving `checked`: upsert each needed
// ingredient (quantities only) and delete rows for ingredients no longer needed.
async function reconcileShoppingItems(planId: number, items: AggregateOutput[]) {
  const keepIds = items.map((i) => i.ingredientId);
  // One transaction: delete rows for ingredients no longer needed, then upsert
  // each needed row. Empty keepIds → notIn: [] is Prisma "always true" → deletes
  // all of the plan's rows. update touches quantities only, so `checked` survives.
  await prisma.$transaction([
    prisma.shoppingItem.deleteMany({
      where: { planId, ingredientId: { notIn: keepIds } },
    }),
    ...items.map((it) =>
      prisma.shoppingItem.upsert({
        where: { planId_ingredientId: { planId, ingredientId: it.ingredientId } },
        create: {
          planId,
          ingredientId: it.ingredientId,
          quantityNeeded: it.quantityNeeded,
          quantityOnHand: it.quantityOnHand,
          quantityToBuy: it.quantityToBuy,
        },
        update: {
          quantityNeeded: it.quantityNeeded,
          quantityOnHand: it.quantityOnHand,
          quantityToBuy: it.quantityToBuy,
        },
      }),
    ),
  ]);
}

// Read path. Current/future weeks recompute live from pantry + plan and
// reconcile the persisted rows (preserving checked). PAST weeks are read-only
// history: return their stored snapshot untouched — recomputing would rewrite a
// completed week's list against *today's* pantry, corrupting what that week needed.
export async function getShoppingList(planId: number) {
  const plan = await prisma.weeklyPlan.findUnique({
    where: { id: planId },
    select: { weekStartDate: true },
  });
  const isPastWeek =
    plan != null &&
    plan.weekStartDate.toISOString().slice(0, 10) < thisWeekSunday(new Date());

  let staples: string[] = [];
  if (!isPastWeek) {
    const computed = await computeShoppingItems(planId);
    staples = computed.staples;
    await reconcileShoppingItems(planId, computed.items);
  }
  const rows = await prisma.shoppingItem.findMany({
    where: { planId },
    include: { ingredient: true },
    orderBy: { ingredient: { category: "asc" } },
  });
  return { items: rows, staples };
}

// The list is now always live on read, so "generate" is just a recompute.
// Kept for the POST /generate route and callers that still invoke it.
export async function generateShoppingList(planId: number) {
  return getShoppingList(planId);
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
