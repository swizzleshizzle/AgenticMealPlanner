import { describe, it, expect, vi } from "vitest";

vi.mock("../../../services/plannerService.js", () => ({
  updatePlannedMeal: vi.fn(), removePlannedMeal: vi.fn(), updatePlan: vi.fn(),
}));
vi.mock("../../../services/pantryService.js", () => ({ deductIngredientsForMeal: vi.fn() }));
vi.mock("../../../claude/mealPlanner.js", () => ({
  generateWeeklyPlan: vi.fn().mockResolvedValue({ id: 99, status: "active", weekStartDate: new Date("2026-05-17"), plannedMeals: [] }),
}));
vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    weeklyPlan: { upsert: vi.fn().mockResolvedValue({ id: 99, weekStartDate: new Date("2026-05-17"), status: "active" }) },
    plannedMeal: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

describe("generate_full_week", () => {
  it("upserts the plan for weekStartDate then calls generateWeeklyPlan", async () => {
    const { planTools } = await import("../../../agent/tools/plan.js");
    const tool = planTools.find((t) => t.name === "generate_full_week")!;
    expect(tool).toBeDefined();
    const out = await tool.handler({ weekStartDate: "2026-05-17" }, { pageContext: {} });
    expect(out.plan.id).toBe(99);
    const { prisma } = await import("../../../lib/prisma.js");
    expect(prisma.weeklyPlan.upsert).toHaveBeenCalledOnce();
    const { generateWeeklyPlan } = await import("../../../claude/mealPlanner.js");
    expect(generateWeeklyPlan).toHaveBeenCalledWith(99);
  });

  it("rejects malformed weekStartDate", async () => {
    const { planTools } = await import("../../../agent/tools/plan.js");
    const tool = planTools.find((t) => t.name === "generate_full_week")!;
    const result = (tool.schema as any).safeParse({ weekStartDate: "not-a-date" });
    expect(result.success).toBe(false);
  });
});
