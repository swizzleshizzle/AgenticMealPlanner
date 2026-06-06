import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { recipeTools } from "../../../agent/tools/recipes.js";
import { createMeal } from "../../../services/mealService.js";

const prisma = new PrismaClient();
const ctx = { pageContext: {} };
const getMeals = recipeTools.find((t) => t.name === "get_meals")!;
const getDetail = recipeTools.find((t) => t.name === "get_meal_detail")!;
const createVersion = recipeTools.find((t) => t.name === "create_recipe_version")!;
const archive = recipeTools.find((t) => t.name === "archive_meal")!;
const editRecipe = recipeTools.find((t) => t.name === "edit_recipe")!;

beforeEach(async () => {
  // Delete dependents first to avoid FK constraint violations
  await prisma.plannedMeal.deleteMany({ where: { meal: { name: { startsWith: "test-" } } } });
  await prisma.meal.deleteMany({ where: { name: { startsWith: "test-" } } });
});

describe("get_meals", () => {
  it("returns active default meals by default", async () => {
    await prisma.meal.create({ data: { name: "test-pasta", isDefault: true, recipeId: 99701 } });
    await prisma.meal.create({ data: { name: "test-pasta-spicy", isDefault: false, recipeId: 99701 } });
    const result: any = await getMeals.handler({ q: "test-pasta", limit: 100 }, ctx);
    const names = result.meals.map((m: any) => m.name);
    expect(names).toContain("test-pasta");
    expect(names).not.toContain("test-pasta-spicy");
  });

  it("filters by search query", async () => {
    await prisma.meal.create({ data: { name: "test-pasta", isDefault: true, recipeId: 99702 } });
    await prisma.meal.create({ data: { name: "test-soup", isDefault: true, recipeId: 99703 } });
    const result: any = await getMeals.handler({ q: "soup" }, ctx);
    const testNames = result.meals.map((m: any) => m.name).filter((n: string) => n.startsWith("test-"));
    expect(testNames).toEqual(["test-soup"]);
  });
});

describe("get_meal_detail", () => {
  it("returns the meal", async () => {
    const m = await prisma.meal.create({ data: { name: "test-pasta", isDefault: true, recipeId: 99704 } });
    const result: any = await getDetail.handler({ mealId: m.id }, ctx);
    expect(result.meal.name).toBe("test-pasta");
  });

  it("includes family when withFamily=true", async () => {
    const a = await prisma.meal.create({ data: { name: "test-pasta", isDefault: true, recipeId: 99705 } });
    await prisma.meal.create({ data: { name: "test-pasta-v2", isDefault: false, recipeId: 99705, parentMealId: a.id } });
    const result: any = await getDetail.handler({ mealId: a.id, withFamily: true }, ctx);
    expect(result.family.length).toBeGreaterThanOrEqual(2);
  });
});

describe("create_recipe_version", () => {
  it("returns a new meal with parentMealId pointing at the source", async () => {
    const src = await prisma.meal.create({ data: { name: "test-pasta", isDefault: true, recipeId: 99706 } });
    const result: any = await createVersion.handler(
      { sourceMealId: src.id, name: "test-pasta-spicy" },
      ctx,
    );
    expect(result.meal.parentMealId).toBe(src.id);
  });
});

describe("archive_meal", () => {
  it("sets archivedAt on the meal", async () => {
    const m = await prisma.meal.create({ data: { name: "test-pasta", isDefault: true, recipeId: 99707 } });
    const result: any = await archive.handler({ mealId: m.id }, ctx);
    expect(result.meal.archivedAt).not.toBeNull();
  });
});

describe("unarchive_meal", () => {
  it("calls unarchiveMeal and clears archivedAt", async () => {
    const m = await prisma.meal.create({
      data: { name: "test-pasta-archived", isDefault: true, recipeId: 99708, archivedAt: new Date() },
    });
    const unarchive = recipeTools.find((t) => t.name === "unarchive_meal")!;
    expect(unarchive).toBeDefined();
    const result: any = await unarchive.handler({ mealId: m.id }, ctx);
    expect(result.meal.archivedAt).toBeNull();
  });

  it("rejects non-integer mealId", () => {
    const unarchive = recipeTools.find((t) => t.name === "unarchive_meal")!;
    expect(unarchive).toBeDefined();
    expect(() => unarchive.schema.parse({ mealId: 1.5 })).toThrow();
  });
});

describe("edit_recipe tool", () => {
  // FK-ordered cleanup: meals (cascades meal_ingredients) before ingredients.
  beforeEach(async () => {
    await prisma.plannedMeal.deleteMany({ where: { meal: { name: { startsWith: "test-" } } } });
    await prisma.meal.deleteMany({ where: { name: { startsWith: "test-" } } });
    await prisma.ingredientAlias.deleteMany({ where: { ingredient: { name: { startsWith: "test-" } } } });
    await prisma.ingredient.deleteMany({ where: { name: { startsWith: "test-" } } });
  });

  async function seedRecipe() {
    const chicken = await prisma.ingredient.create({
      data: { name: "test-chicken", category: "protein", defaultUnit: "lb" },
    });
    const meal = await createMeal({
      name: "test-stir-fry",
      servings: 2,
      instructions: ["cook the chicken"],
      ingredients: [{ ingredientId: chicken.id, quantity: 1, unit: "lb" }],
    });
    return { chicken, meal };
  }

  it("exists and is registered", () => {
    expect(editRecipe).toBeDefined();
  });

  it("swaps an ingredient and saves a new version (source archived)", async () => {
    const { meal } = await seedRecipe();

    const result: any = await editRecipe.handler({
      mealId: meal.id,
      ingredients: [{ name: "test-tofu", quantity: 14, unit: "oz", category: "protein" }],
      instructions: ["press the tofu", "cook the tofu"],
      mode: "version",
    }, ctx);

    // new meal, same family
    expect(result.meal.id).not.toBe(meal.id);
    expect(result.meal.recipeId).toBe(meal.recipeId);
    // tofu resolved/created onto the new version
    const names = result.meal.ingredients.map((mi: any) => mi.ingredient.name);
    expect(names).toContain("test-tofu");
    expect(names).not.toContain("test-chicken");
    // instructions rewritten
    const instr = typeof result.meal.instructions === "string"
      ? JSON.parse(result.meal.instructions)
      : result.meal.instructions;
    expect(instr).toContain("press the tofu");
    // source archived (version semantics)
    const source = await prisma.meal.findUnique({ where: { id: meal.id } });
    expect(source?.archivedAt).not.toBeNull();
  });

  it("mode=variant leaves the original active", async () => {
    const { meal } = await seedRecipe();

    const result: any = await editRecipe.handler({
      mealId: meal.id,
      ingredients: [{ name: "test-tofu", quantity: 14, unit: "oz", category: "protein" }],
      mode: "variant",
    }, ctx);

    expect(result.meal.id).not.toBe(meal.id);
    const source = await prisma.meal.findUnique({ where: { id: meal.id } });
    expect(source?.archivedAt).toBeNull();
  });

  it("rejects an empty ingredients list at the schema", () => {
    const parsed = editRecipe.schema.safeParse({ mealId: 1, ingredients: [] });
    expect(parsed.success).toBe(false);
  });
});
