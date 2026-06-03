import { describe, it, expect, vi } from "vitest";

vi.mock("../../../services/plannerService.js", () => ({
  updatePlannedMeal: vi.fn(),
  removePlannedMeal: vi.fn(),
  updatePlan: vi.fn().mockResolvedValue({ id: 5, status: "completed", weekStartDate: new Date("2026-05-10") }),
}));
vi.mock("../../../services/pantryService.js", () => ({ deductIngredientsForMeal: vi.fn() }));
vi.mock("../../../lib/prisma.js", () => ({ prisma: { weeklyPlan: { upsert: vi.fn() }, plannedMeal: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, $transaction: vi.fn() } }));

describe("set_plan_status", () => {
  it("calls updatePlan with the new status and returns the plan", async () => {
    const { planTools } = await import("../../../agent/tools/plan.js");
    const tool = planTools.find((t) => t.name === "set_plan_status")!;
    expect(tool).toBeDefined();
    const out = await tool.handler({ planId: 5, status: "completed" }, { pageContext: {} });
    expect(out).toMatchObject({ plan: { id: 5, status: "completed" } });
    const { updatePlan } = await import("../../../services/plannerService.js");
    expect(updatePlan).toHaveBeenCalledWith(5, { status: "completed" });
  });

  it("rejects an unknown status", async () => {
    const { planTools } = await import("../../../agent/tools/plan.js");
    const tool = planTools.find((t) => t.name === "set_plan_status")!;
    const result = (tool.schema as any).safeParse({ planId: 5, status: "bogus" });
    expect(result.success).toBe(false);
  });
});
