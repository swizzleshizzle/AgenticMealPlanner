import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { planTools } from "../../../agent/tools/plan.js";

const prisma = new PrismaClient();
const ctx = { pageContext: {} };
const getPlannedWeek = planTools.find((t) => t.name === "get_planned_week")!;

async function seedMeal(name: string) {
  return prisma.meal.create({
    data: { name, recipeId: 99999, isDefault: true },
  });
}

describe("get_planned_week tool", () => {
  beforeEach(async () => {
    await prisma.plannedMeal.deleteMany({ where: { meal: { name: { startsWith: "test-" } } } });
    await prisma.weeklyPlan.deleteMany({ where: { weekStartDate: { in: [new Date("2099-01-19"), new Date("2099-01-05")] } } });
    await prisma.meal.deleteMany({ where: { name: { startsWith: "test-" } } });
  });

  it("returns null when no plan exists for the week", async () => {
    const result: any = await getPlannedWeek.handler(
      { weekStartDate: "2099-01-19" },
      ctx,
    );
    expect(result.plan).toBeNull();
  });

  it("returns the plan with planned meals for the given week", async () => {
    const meal = await seedMeal("test-chili");
    const plan = await prisma.weeklyPlan.create({
      data: { weekStartDate: new Date("2099-01-05"), status: "active" },
    });
    await prisma.plannedMeal.create({
      data: {
        planId: plan.id,
        mealId: meal.id,
        day: "monday",
        mealSlot: "dinner",
        servings: 2,
        status: "planned",
      },
    });
    const result: any = await getPlannedWeek.handler(
      { weekStartDate: "2099-01-05" },
      ctx,
    );
    expect(result.plan).not.toBeNull();
    expect(result.plan.meals).toHaveLength(1);
    expect(result.plan.meals[0].mealName).toBe("test-chili");
  });

  it("defaults to the page context's weekStartDate when no arg given", async () => {
    const meal = await seedMeal("test-chili");
    const plan = await prisma.weeklyPlan.create({
      data: { weekStartDate: new Date("2099-01-05"), status: "active" },
    });
    await prisma.plannedMeal.create({
      data: {
        planId: plan.id,
        mealId: meal.id,
        day: "tuesday",
        mealSlot: "lunch",
        servings: 1,
        status: "planned",
      },
    });
    const result: any = await getPlannedWeek.handler(
      {},
      { pageContext: { weekStartDate: "2099-01-05" } },
    );
    expect(result.plan?.meals).toHaveLength(1);
  });
});
