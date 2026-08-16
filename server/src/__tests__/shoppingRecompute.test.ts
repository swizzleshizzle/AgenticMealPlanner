// Runs against mealplanner_test only (vitest loads .env.test). Wipes tables in reset().
import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getShoppingList, toggleShoppingItem } from "../services/shoppingService.js";
import { thisWeekSunday } from "../lib/week.js";

const prisma = new PrismaClient();

async function reset() {
  await prisma.shoppingItem.deleteMany();
  await prisma.plannedMeal.deleteMany();
  await prisma.weeklyPlan.deleteMany();
  await prisma.pantryBatch.deleteMany();
  await prisma.mealIngredient.deleteMany();
  await prisma.ingredient.deleteMany();
}

// Create a plan with one cook_fresh meal needing `qty count` of one ingredient,
// plus an optional active pantry batch. Returns { planId, ingredientId }.
async function seed(opts: { need: number; pantry?: number }) {
  const ing = await prisma.ingredient.create({
    data: { name: "onion", category: "produce", defaultUnit: "count" },
  });
  const plan = await prisma.weeklyPlan.create({ data: { weekStartDate: new Date(thisWeekSunday(new Date())) } });
  const meal = await prisma.meal.create({
    data: {
      recipeId: ing.id, name: "Test", servings: 2, isDefault: true,
      ingredients: { create: [{ ingredientId: ing.id, quantity: opts.need, unit: "whole" }] },
    },
  });
  await prisma.plannedMeal.create({
    data: { planId: plan.id, mealId: meal.id, day: "monday", mealSlot: "dinner", servings: 2, status: "planned", cookStyle: "cook_fresh" },
  });
  if (opts.pantry != null) {
    await prisma.pantryBatch.create({ data: { ingredientId: ing.id, quantity: opts.pantry, unit: "whole" } });
  }
  return { planId: plan.id, ingredientId: ing.id };
}

describe("getShoppingList — recompute on read", () => {
  beforeEach(reset);

  it("preserves checked across recompute", async () => {
    const { planId } = await seed({ need: 2 });
    const first = await getShoppingList(planId);
    const row = first.items.find((i) => i.quantityToBuy > 0)!;
    await toggleShoppingItem(row.id, true);

    const second = await getShoppingList(planId);
    const same = second.items.find((i) => i.ingredientId === row.ingredientId)!;
    expect(same.checked).toBe(true);
  });

  it("reflects a removed pantry batch on the next read", async () => {
    const { planId, ingredientId } = await seed({ need: 2, pantry: 5 });
    const before = await getShoppingList(planId);
    expect(before.items.find((i) => i.ingredientId === ingredientId)!.quantityToBuy).toBe(0); // fully covered

    // Soft-delete the pantry batch (what "remove from pantry" does).
    await prisma.pantryBatch.updateMany({ where: { ingredientId }, data: { consumedAt: new Date() } });

    const after = await getShoppingList(planId);
    expect(after.items.find((i) => i.ingredientId === ingredientId)!.quantityToBuy).toBe(2);
  });

  it("drops rows for ingredients no longer needed", async () => {
    const { planId } = await seed({ need: 2 });
    await getShoppingList(planId);
    // Remove all planned meals → nothing needed.
    await prisma.plannedMeal.deleteMany({ where: { planId } });
    const after = await getShoppingList(planId);
    expect(after.items).toEqual([]);
    expect(await prisma.shoppingItem.count({ where: { planId } })).toBe(0);
  });

  it("satisfies an aliased ingredient's need from the canonical ingredient's stock", async () => {
    // Recipe references "chicken cutlet" (its own ingredient record); the
    // pantry holds "chicken breast"; an alias row links the two. The list must
    // pool them under the canonical ingredient instead of demanding cutlets.
    const breast = await prisma.ingredient.create({
      data: { name: "chicken breast", category: "protein", defaultUnit: "oz" },
    });
    const cutlet = await prisma.ingredient.create({
      data: { name: "chicken cutlet", category: "protein", defaultUnit: "oz" },
    });
    await prisma.ingredientAlias.create({
      data: { alias: "chicken cutlet", ingredientId: breast.id },
    });
    const plan = await prisma.weeklyPlan.create({
      data: { weekStartDate: new Date(thisWeekSunday(new Date())) },
    });
    const meal = await prisma.meal.create({
      data: {
        recipeId: cutlet.id, name: "Onion Crunch Chicken", servings: 2, isDefault: true,
        ingredients: { create: [{ ingredientId: cutlet.id, quantity: 42, unit: "oz" }] },
      },
    });
    await prisma.plannedMeal.create({
      data: { planId: plan.id, mealId: meal.id, day: "monday", mealSlot: "dinner", servings: 2, status: "planned", cookStyle: "cook_fresh" },
    });
    await prisma.pantryBatch.create({
      data: { ingredientId: breast.id, quantity: 1.25, unit: "lb" },
    });

    const res = await getShoppingList(plan.id);

    expect(res.items).toHaveLength(1);
    const row = res.items[0];
    expect(row.ingredientId).toBe(breast.id);
    expect(row.quantityNeeded).toBeCloseTo(42, 5);
    expect(row.quantityOnHand).toBeCloseTo(20, 5); // 1.25 lb
    expect(row.quantityToBuy).toBeCloseTo(22, 5);
  });

  it("flags items whose pantry stock was skipped by an impossible unit conversion", async () => {
    // Recipe wants ranch by weight (oz); the pantry bottle is fl oz. Without a
    // density hint the on-hand credit is dropped — the row must say so instead
    // of silently telling the user to buy a bottle they own.
    const ranch = await prisma.ingredient.create({
      data: { name: "buttermilk ranch dressing", category: "condiment", defaultUnit: "oz" },
    });
    const plan = await prisma.weeklyPlan.create({
      data: { weekStartDate: new Date(thisWeekSunday(new Date())) },
    });
    const meal = await prisma.meal.create({
      data: {
        recipeId: ranch.id, name: "Loaded Potatoes", servings: 2, isDefault: true,
        ingredients: { create: [{ ingredientId: ranch.id, quantity: 3, unit: "oz" }] },
      },
    });
    await prisma.plannedMeal.create({
      data: { planId: plan.id, mealId: meal.id, day: "monday", mealSlot: "dinner", servings: 2, status: "planned", cookStyle: "cook_fresh" },
    });
    await prisma.pantryBatch.create({
      data: { ingredientId: ranch.id, quantity: 16, unit: "fl oz" },
    });

    const res = await getShoppingList(plan.id);

    const row = res.items.find((i) => i.ingredientId === ranch.id)!;
    expect(row.quantityToBuy).toBeCloseTo(3, 5); // credit was skipped…
    expect(row.partial).toBe(true); // …but the row admits it
  });

  it("returns partial: false for cleanly-converted items", async () => {
    const { planId, ingredientId } = await seed({ need: 2, pantry: 5 });
    const res = await getShoppingList(planId);
    expect(res.items.find((i) => i.ingredientId === ingredientId)!.partial).toBe(false);
  });

  it("does not recompute or rewrite a past week's stored list", async () => {
    const ing = await prisma.ingredient.create({
      data: { name: "onion", category: "produce", defaultUnit: "count" },
    });
    const plan = await prisma.weeklyPlan.create({
      data: { weekStartDate: new Date("2020-01-05") }, // clearly past
    });
    const meal = await prisma.meal.create({
      data: {
        recipeId: ing.id, name: "T", servings: 2, isDefault: true,
        ingredients: { create: [{ ingredientId: ing.id, quantity: 2, unit: "whole" }] },
      },
    });
    await prisma.plannedMeal.create({
      data: { planId: plan.id, mealId: meal.id, day: "monday", mealSlot: "dinner", servings: 2, status: "planned", cookStyle: "cook_fresh" },
    });
    // A snapshot from when the week was current: "already had it, checked off".
    await prisma.shoppingItem.create({
      data: { planId: plan.id, ingredientId: ing.id, quantityNeeded: 2, quantityOnHand: 2, quantityToBuy: 0, checked: true },
    });

    const res = await getShoppingList(plan.id);

    // Returned as-is: a live recompute (no active pantry) would set quantityToBuy=2
    // and reset checked — the past-week gate must prevent both.
    const row = res.items.find((i) => i.ingredientId === ing.id)!;
    expect(row.quantityToBuy).toBe(0);
    expect(row.checked).toBe(true);
    expect(res.items).toHaveLength(1);
  });
});
