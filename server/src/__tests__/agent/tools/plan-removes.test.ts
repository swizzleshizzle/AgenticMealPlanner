import { describe, it, expect, vi } from "vitest";

vi.mock("../../../services/plannerService.js", () => ({
  updatePlannedMeal: vi.fn(),
  removePlannedMeal: vi.fn().mockResolvedValue({ id: 42 }),
  updatePlan: vi.fn(),
}));
vi.mock("../../../services/pantryService.js", () => ({ deductIngredientsForMeal: vi.fn() }));
vi.mock("../../../lib/prisma.js", () => ({ prisma: { weeklyPlan: { upsert: vi.fn() }, plannedMeal: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, $transaction: vi.fn() } }));

describe("remove_planned_meal", () => {
  it("calls removePlannedMeal and returns the deleted id", async () => {
    const { planTools } = await import("../../../agent/tools/plan.js");
    const tool = planTools.find((t) => t.name === "remove_planned_meal")!;
    expect(tool).toBeDefined();
    const out = await tool.handler({ plannedMealId: 42, confirmed: true }, { pageContext: {} });
    expect(out).toEqual({ deletedId: 42 });
    const { removePlannedMeal } = await import("../../../services/plannerService.js");
    expect(vi.mocked(removePlannedMeal)).toHaveBeenCalledWith(42);
  });

  it("refuses to remove without confirmation", async () => {
    const { planTools } = await import("../../../agent/tools/plan.js");
    const tool = planTools.find((t) => t.name === "remove_planned_meal")!;
    const { removePlannedMeal } = await import("../../../services/plannerService.js");
    vi.mocked(removePlannedMeal).mockClear();
    await expect(tool.handler({ plannedMealId: 42 }, { pageContext: {} })).rejects.toThrow(/confirm/i);
    expect(vi.mocked(removePlannedMeal)).not.toHaveBeenCalled();
  });
});
