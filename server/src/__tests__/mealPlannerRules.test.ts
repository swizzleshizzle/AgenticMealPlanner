import { describe, it, expect } from "vitest";
import { filterValidPlannedMeals } from "../claude/mealPlannerRules.js";

type M = { id: number; canBatch: boolean; canFresh: boolean };

const meals: Record<number, M> = {
  1: { id: 1, canBatch: true,  canFresh: false }, // batch only
  2: { id: 2, canBatch: false, canFresh: true  }, // fresh only
  3: { id: 3, canBatch: true,  canFresh: true  }, // both
};

describe("filterValidPlannedMeals — cookStyle rules", () => {
  it("keeps batch_prep only when day=sunday and meal canBatch", () => {
    const input = [
      { mealId: 1, day: "sunday", mealSlot: "dinner", servings: 4, cookStyle: "batch_prep" as const },
      { mealId: 3, day: "sunday", mealSlot: "lunch",  servings: 4, cookStyle: "batch_prep" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual(input);
  });

  it("drops batch_prep on non-Sunday days", () => {
    const input = [
      { mealId: 1, day: "monday", mealSlot: "dinner", servings: 4, cookStyle: "batch_prep" as const },
      { mealId: 2, day: "monday", mealSlot: "lunch",  servings: 2, cookStyle: "cook_fresh" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([
      { mealId: 2, day: "monday", mealSlot: "lunch", servings: 2, cookStyle: "cook_fresh" },
    ]);
  });

  it("drops Sunday batch_prep when meal can't batch", () => {
    const input = [
      { mealId: 2, day: "sunday", mealSlot: "dinner", servings: 4, cookStyle: "batch_prep" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });

  it("drops cook_fresh picks whose meal can't fresh", () => {
    const input = [
      { mealId: 1, day: "monday", mealSlot: "dinner", servings: 2, cookStyle: "cook_fresh" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });

  it("accepts leftovers on any day regardless of meal capability", () => {
    const input = [
      { mealId: 1, day: "tuesday", mealSlot: "lunch", servings: 2, cookStyle: "leftovers" as const },
      { mealId: 2, day: "thursday", mealSlot: "dinner", servings: 2, cookStyle: "leftovers" as const },
      { mealId: 3, day: "sunday", mealSlot: "dinner", servings: 2, cookStyle: "leftovers" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual(input);
  });

  it("drops planned meals whose mealId is unknown regardless of cookStyle", () => {
    const input = [
      { mealId: 999, day: "monday", mealSlot: "dinner", servings: 2, cookStyle: "cook_fresh" as const },
      { mealId: 999, day: "tuesday", mealSlot: "lunch", servings: 2, cookStyle: "leftovers" as const },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });
});
