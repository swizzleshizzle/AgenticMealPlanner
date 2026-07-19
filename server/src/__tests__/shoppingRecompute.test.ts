// Runs against mealplanner_test only (vitest loads .env.test). Wipes tables in reset().
import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getShoppingList, toggleShoppingItem } from "../services/shoppingService.js";

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
  const plan = await prisma.weeklyPlan.create({ data: { weekStartDate: new Date("2026-05-17") } });
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
});
