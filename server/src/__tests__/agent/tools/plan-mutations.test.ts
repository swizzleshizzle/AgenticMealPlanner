import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { planTools } from "../../../agent/tools/plan.js";

const prisma = new PrismaClient();
const ctx = { pageContext: {} };
const swap = planTools.find((t) => t.name === "swap_meal")!;
const skip = planTools.find((t) => t.name === "skip_meal")!;
const scale = planTools.find((t) => t.name === "scale_servings")!;

async function seedPlannedMeal() {
  const a = await prisma.meal.create({ data: { name: "test-A", isDefault: true, recipeId: 99901 } });
  const b = await prisma.meal.create({ data: { name: "test-B", isDefault: true, recipeId: 99902 } });
  const plan = await prisma.weeklyPlan.create({ data: { weekStartDate: new Date("2026-05-11"), status: "active" } });
  const pm = await prisma.plannedMeal.create({
    data: { planId: plan.id, mealId: a.id, day: "monday", mealSlot: "dinner", servings: 2, status: "planned" },
  });
  return { a, b, plan, pm };
}

beforeEach(async () => {
  await prisma.plannedMeal.deleteMany({ where: { meal: { name: { startsWith: "test-" } } } });
  await prisma.weeklyPlan.deleteMany({ where: { weekStartDate: new Date("2026-05-11") } });
  await prisma.meal.deleteMany({ where: { name: { startsWith: "test-" } } });
});

describe("swap_meal", () => {
  it("replaces the mealId on the planned meal", async () => {
    const { b, pm } = await seedPlannedMeal();
    const result: any = await swap.handler({ plannedMealId: pm.id, newMealId: b.id }, ctx);
    expect(result.plannedMeal.mealId).toBe(b.id);
  });
});

describe("skip_meal", () => {
  it("sets status to skipped", async () => {
    const { pm } = await seedPlannedMeal();
    const result: any = await skip.handler({ plannedMealId: pm.id }, ctx);
    expect(result.plannedMeal.status).toBe("skipped");
  });
});

describe("scale_servings", () => {
  it("updates the servings count", async () => {
    const { pm } = await seedPlannedMeal();
    const result: any = await scale.handler({ plannedMealId: pm.id, newServings: 5 }, ctx);
    expect(result.plannedMeal.servings).toBe(5);
  });
});
