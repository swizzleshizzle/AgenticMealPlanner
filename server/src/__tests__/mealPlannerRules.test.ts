import { describe, it, expect } from "vitest";
import { filterValidPlannedMeals } from "../claude/mealPlannerRules.js";

type M = { id: number; canBatch: boolean; canFresh: boolean };

const meals: Record<number, M> = {
  1: { id: 1, canBatch: true,  canFresh: false }, // batch only
  2: { id: 2, canBatch: false, canFresh: true  }, // fresh only
  3: { id: 3, canBatch: true,  canFresh: true  }, // both
};

describe("filterValidPlannedMeals — Sunday-only batch rule", () => {
  it("keeps isPrep=true only when day=sunday and meal canBatch", () => {
    const input = [
      { mealId: 1, day: "sunday",   mealSlot: "dinner", servings: 2, isPrep: true },
      { mealId: 3, day: "sunday",   mealSlot: "lunch",  servings: 2, isPrep: true },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual(input);
  });

  it("drops isPrep=true on non-Sunday days", () => {
    const input = [
      { mealId: 1, day: "monday", mealSlot: "dinner", servings: 2, isPrep: true },
      { mealId: 2, day: "monday", mealSlot: "lunch",  servings: 2, isPrep: false },
    ];
    const out = filterValidPlannedMeals(input, meals);
    expect(out).toEqual([
      { mealId: 2, day: "monday", mealSlot: "lunch", servings: 2, isPrep: false },
    ]);
  });

  it("drops Sunday isPrep=true when meal can't batch", () => {
    const input = [
      { mealId: 2, day: "sunday", mealSlot: "dinner", servings: 2, isPrep: true },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });

  it("drops fresh picks whose meal can't fresh", () => {
    const input = [
      { mealId: 1, day: "monday", mealSlot: "dinner", servings: 2, isPrep: false },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });

  it("drops planned meals whose mealId is unknown", () => {
    const input = [
      { mealId: 999, day: "monday", mealSlot: "dinner", servings: 2, isPrep: false },
    ];
    expect(filterValidPlannedMeals(input, meals)).toEqual([]);
  });
});
