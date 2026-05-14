import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { planTools } from "../../../agent/tools/plan.js";

const prisma = new PrismaClient();
const ctx = { pageContext: {} };
const addPlanned = planTools.find((t) => t.name === "add_planned_meal")!;
const markCooked = planTools.find((t) => t.name === "mark_meal_cooked")!;

beforeEach(async () => {
  await prisma.plannedMeal.deleteMany({ where: { meal: { name: { startsWith: "test-" } } } });
  await prisma.weeklyPlan.deleteMany({ where: { weekStartDate: { in: [new Date("2099-01-05"), new Date("2099-01-12")] } } });
  await prisma.meal.deleteMany({ where: { name: { startsWith: "test-" } } });
});

describe("add_planned_meal", () => {
  it("creates a PlannedMeal on an existing plan", async () => {
    const meal = await prisma.meal.create({ data: { name: "test-soup", isDefault: true, recipeId: 99801 } });
    await prisma.weeklyPlan.create({ data: { weekStartDate: new Date("2099-01-05"), status: "active" } });
    const result: any = await addPlanned.handler(
      { weekStartDate: "2099-01-05", mealId: meal.id, day: "wednesday", mealSlot: "dinner", servings: 4 },
      ctx,
    );
    expect(result.plannedMeal.mealId).toBe(meal.id);
    expect(result.plannedMeal.day).toBe("wednesday");
  });

  it("creates a new WeeklyPlan if one doesn't exist for the week", async () => {
    const meal = await prisma.meal.create({ data: { name: "test-soup", isDefault: true, recipeId: 99802 } });
    const result: any = await addPlanned.handler(
      { weekStartDate: "2099-01-12", mealId: meal.id, day: "friday", mealSlot: "dinner", servings: 2 },
      ctx,
    );
    expect(result.plannedMeal.planId).toBeGreaterThan(0);
    const plan = await prisma.weeklyPlan.findUnique({ where: { id: result.plannedMeal.planId } });
    expect(plan?.weekStartDate.toISOString().slice(0, 10)).toBe("2099-01-12");
  });
});

describe("mark_meal_cooked", () => {
  it("returns shortfalls when pantry is empty", async () => {
    const meal = await prisma.meal.create({ data: { name: "test-stew", isDefault: true, recipeId: 99803 } });
    const plan = await prisma.weeklyPlan.create({ data: { weekStartDate: new Date("2099-01-05"), status: "active" } });
    const pm = await prisma.plannedMeal.create({
      data: { planId: plan.id, mealId: meal.id, day: "monday", mealSlot: "dinner", servings: 2, status: "planned" },
    });
    const result: any = await markCooked.handler({ plannedMealId: pm.id }, ctx);
    expect(result.plannedMeal.status).toBe("cooked");
    expect(Array.isArray(result.shortfalls)).toBe(true);
  });
});
