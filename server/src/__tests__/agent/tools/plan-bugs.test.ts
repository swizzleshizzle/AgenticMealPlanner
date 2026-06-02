import { describe, it, expect, vi } from "vitest";

const mockPrismaInstance = {
  $transaction: vi.fn(),
  plannedMeal: { findUnique: vi.fn(), update: vi.fn() },
  weeklyPlan: { findFirst: vi.fn(), create: vi.fn(), upsert: vi.fn() },
};

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => mockPrismaInstance),
}));
vi.mock("../../../services/plannerService.js", () => ({
  updatePlannedMeal: vi.fn(),
}));
vi.mock("../../../services/pantryService.js", () => ({
  deductIngredientsForMeal: vi.fn().mockResolvedValue({ shortfalls: [] }),
}));

describe("add_planned_meal mealSlot enum", () => {
  it("rejects 'snack' in the schema", async () => {
    const { planTools } = await import("../../../agent/tools/plan.js");
    const addPlannedMeal = planTools.find((t) => t.name === "add_planned_meal")!;
    const parsed = (addPlannedMeal.schema as any).safeParse({
      weekStartDate: "2026-05-10",
      mealId: 1,
      day: "monday",
      mealSlot: "snack",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts breakfast/lunch/dinner", async () => {
    const { planTools } = await import("../../../agent/tools/plan.js");
    const addPlannedMeal = planTools.find((t) => t.name === "add_planned_meal")!;
    for (const slot of ["breakfast", "lunch", "dinner"]) {
      const parsed = (addPlannedMeal.schema as any).safeParse({
        weekStartDate: "2026-05-10",
        mealId: 1,
        day: "monday",
        mealSlot: slot,
      });
      expect(parsed.success).toBe(true);
    }
  });
});

describe("mark_meal_cooked idempotency", () => {
  it("throws when planned meal status is already 'cooked'", async () => {
    const { planTools } = await import("../../../agent/tools/plan.js");
    const markMealCooked = planTools.find((t) => t.name === "mark_meal_cooked")!;
    const tx = {
      plannedMeal: {
        findUnique: vi.fn().mockResolvedValue({
          id: 1, mealId: 1, servings: 2, status: "cooked", meal: { servings: 2 },
        }),
        update: vi.fn(),
      },
    };
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new (PrismaClient as any)();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await expect(markMealCooked.handler({ plannedMealId: 1 }, { pageContext: {} })).rejects.toThrow(/already cooked/);
    expect(tx.plannedMeal.update).not.toHaveBeenCalled();
  });
});
