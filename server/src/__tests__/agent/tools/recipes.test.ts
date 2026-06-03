import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { recipeTools } from "../../../agent/tools/recipes.js";

const prisma = new PrismaClient();
const ctx = { pageContext: {} };
const getMeals = recipeTools.find((t) => t.name === "get_meals")!;
const getDetail = recipeTools.find((t) => t.name === "get_meal_detail")!;
const createVersion = recipeTools.find((t) => t.name === "create_recipe_version")!;
const archive = recipeTools.find((t) => t.name === "archive_meal")!;

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
