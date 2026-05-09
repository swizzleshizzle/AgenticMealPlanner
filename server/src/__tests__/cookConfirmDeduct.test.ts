import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { deductIngredientsForMeal } from "../services/pantryService.js";

const prisma = new PrismaClient();

async function reset() {
  // Order matters due to FKs.
  await prisma.shoppingItem.deleteMany();
  await prisma.plannedMeal.deleteMany();
  await prisma.weeklyPlan.deleteMany();
  await prisma.pantryBatch.deleteMany();
  await prisma.mealIngredient.deleteMany();
  await prisma.meal.deleteMany();
  await prisma.ingredient.deleteMany();
}

async function makeIngredient(name: string, opts: { densityGPerMl?: number; gramsPerCount?: number } = {}) {
  return prisma.ingredient.create({
    data: {
      name,
      defaultUnit: "g",
      densityGPerMl: opts.densityGPerMl ?? null,
      gramsPerCount: opts.gramsPerCount ?? null,
    },
  });
}

async function makeBatch(ingredientId: number, quantity: number, unit: string) {
  return prisma.pantryBatch.create({
    data: {
      ingredientId,
      quantity,
      unit,
      location: "pantry",
    },
  });
}

describe("deductIngredientsForMeal — overrides path", () => {
  beforeEach(reset);

  it("happy path: deducts each override row from pantry, no shortfalls", async () => {
    const chicken = await makeIngredient("chicken thighs");
    const soy = await makeIngredient("soy sauce", { densityGPerMl: 1.2 });
    await makeBatch(chicken.id, 500, "g");
    await makeBatch(soy.id, 240, "ml");

    const result = await deductIngredientsForMeal(0, 0, [
      { ingredientId: chicken.id, quantity: 200, unit: "g" },
      { ingredientId: soy.id, quantity: 30, unit: "ml" },
    ]);

    expect(result.shortfalls).toEqual([]);
    const remaining = await prisma.pantryBatch.findMany({
      where: { consumedAt: null },
      orderBy: { id: "asc" },
    });
    expect(remaining.find((b) => b.ingredientId === chicken.id)?.quantity).toBeCloseTo(300, 5);
    expect(remaining.find((b) => b.ingredientId === soy.id)?.quantity).toBeCloseTo(210, 5);
  });

  it("insufficient: deducts what exists, returns reason=insufficient with availableQuantity", async () => {
    const onion = await makeIngredient("onion");
    await makeBatch(onion.id, 100, "g");

    const result = await deductIngredientsForMeal(0, 0, [
      { ingredientId: onion.id, quantity: 250, unit: "g" },
    ]);

    expect(result.shortfalls).toEqual([
      {
        ingredientId: onion.id,
        ingredientName: "onion",
        requestedQuantity: 250,
        requestedUnit: "g",
        availableQuantity: 100,
        reason: "insufficient",
      },
    ]);
    const remaining = await prisma.pantryBatch.findMany({ where: { consumedAt: null } });
    expect(remaining).toHaveLength(0);
  });

  it("no_pantry: ingredient has no active batches", async () => {
    const ginger = await makeIngredient("ginger");

    const result = await deductIngredientsForMeal(0, 0, [
      { ingredientId: ginger.id, quantity: 5, unit: "g" },
    ]);

    expect(result.shortfalls).toEqual([
      {
        ingredientId: ginger.id,
        ingredientName: "ginger",
        requestedQuantity: 5,
        requestedUnit: "g",
        availableQuantity: 0,
        reason: "no_pantry",
      },
    ]);
  });

  it("no_density: cross-family unit with no ingredient density", async () => {
    const honey = await makeIngredient("honey"); // no density set
    await makeBatch(honey.id, 240, "ml");

    const result = await deductIngredientsForMeal(0, 0, [
      { ingredientId: honey.id, quantity: 10, unit: "g" }, // ml -> g needs density
    ]);

    expect(result.shortfalls).toEqual([
      {
        ingredientId: honey.id,
        ingredientName: "honey",
        requestedQuantity: 10,
        requestedUnit: "g",
        availableQuantity: 0,
        reason: "no_density",
      },
    ]);
    const remaining = await prisma.pantryBatch.findMany({ where: { consumedAt: null } });
    expect(remaining[0].quantity).toBe(240); // untouched
  });

  it("mixed: returns one shortfall per failing row, deducts the successful one", async () => {
    const chicken = await makeIngredient("chicken thighs");
    const onion = await makeIngredient("onion");
    const ginger = await makeIngredient("ginger");
    const honey = await makeIngredient("honey");
    await makeBatch(chicken.id, 500, "g");
    await makeBatch(onion.id, 50, "g");
    await makeBatch(honey.id, 240, "ml");

    const result = await deductIngredientsForMeal(0, 0, [
      { ingredientId: chicken.id, quantity: 200, unit: "g" },
      { ingredientId: onion.id, quantity: 100, unit: "g" },
      { ingredientId: ginger.id, quantity: 5, unit: "g" },
      { ingredientId: honey.id, quantity: 10, unit: "g" },
    ]);

    expect(result.shortfalls.map((s) => s.reason).sort()).toEqual(["insufficient", "no_density", "no_pantry"]);
    const chickenBatch = await prisma.pantryBatch.findFirst({ where: { ingredientId: chicken.id, consumedAt: null } });
    expect(chickenBatch?.quantity).toBeCloseTo(300, 5);
  });

  it("ignores mealId/servingMultiplier when overrides present", async () => {
    const onion = await makeIngredient("onion");
    await makeBatch(onion.id, 100, "g");

    const result = await deductIngredientsForMeal(99999, 99, [
      { ingredientId: onion.id, quantity: 25, unit: "g" },
    ]);

    expect(result.shortfalls).toEqual([]);
    const remaining = await prisma.pantryBatch.findFirst({ where: { ingredientId: onion.id, consumedAt: null } });
    expect(remaining?.quantity).toBeCloseTo(75, 5);
  });
});

describe("deductIngredientsForMeal — recipe-derived path (overrides omitted)", () => {
  beforeEach(reset);

  it("falls back to MealIngredient rows scaled by multiplier", async () => {
    const chicken = await prisma.ingredient.create({
      data: { name: "chicken thighs", defaultUnit: "g" },
    });
    // Use raw SQL because the test DB may have a recipe_id NOT NULL column from
    // the recipe-versioning migration that isn't reflected in this branch's schema.
    const mealRows = await prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO meals (name, servings, instructions, recipe_id, version_number, is_default, updated_at)
      VALUES ('Test stir fry', 4, '[]'::jsonb, 1, 1, true, now())
      RETURNING id
    `;
    const mealId = mealRows[0].id;
    await prisma.mealIngredient.create({
      data: { mealId, ingredientId: chicken.id, quantity: 400, unit: "g" },
    });
    await prisma.pantryBatch.create({
      data: { ingredientId: chicken.id, quantity: 500, unit: "g", location: "pantry" },
    });

    const result = await deductIngredientsForMeal(mealId, 0.5);

    expect(result.shortfalls).toEqual([]);
    const remaining = await prisma.pantryBatch.findFirst({
      where: { ingredientId: chicken.id, consumedAt: null },
    });
    expect(remaining?.quantity).toBeCloseTo(300, 5); // 500 - (400 * 0.5)
  });
});
