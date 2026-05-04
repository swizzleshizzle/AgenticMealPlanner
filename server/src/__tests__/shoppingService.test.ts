import { describe, it, expect } from "vitest";
import { aggregateShoppingItems, type AggregateInput } from "../services/shoppingService.js";

// Test fixtures: a recipe with two ingredients, ingredient ids 100 and 101.
function pm(opts: {
  cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
  servings?: number;
  recipeServings?: number;
}): AggregateInput["plannedMeals"][number] {
  return {
    cookStyle: opts.cookStyle,
    servings: opts.servings ?? 2,
    meal: {
      servings: opts.recipeServings ?? 2,
      ingredients: [
        { ingredientId: 100, quantity: 1, unit: "lb" },
        { ingredientId: 101, quantity: 0.5, unit: "cup" },
      ],
    },
  };
}

describe("aggregateShoppingItems", () => {
  it("aggregates ingredients across cook_fresh and batch_prep meals", () => {
    const input: AggregateInput = {
      plannedMeals: [
        pm({ cookStyle: "cook_fresh" }),
        pm({ cookStyle: "batch_prep", servings: 4 }),
      ],
      pantryItems: [],
    };
    const result = aggregateShoppingItems(input);
    // 1 lb (cook_fresh @ 2/2 servings) + 2 lb (batch_prep @ 4/2 servings) = 3 lb
    expect(result.find((r) => r.ingredientId === 100)?.quantityNeeded).toBe(3);
    // 0.5 cup * 1 + 0.5 cup * 2 = 1.5 cup
    expect(result.find((r) => r.ingredientId === 101)?.quantityNeeded).toBe(1.5);
  });

  it("excludes leftovers from aggregation", () => {
    const input: AggregateInput = {
      plannedMeals: [
        pm({ cookStyle: "cook_fresh" }),     // contributes 1 lb
        pm({ cookStyle: "leftovers" }),       // excluded
        pm({ cookStyle: "leftovers", servings: 4 }), // excluded even at higher servings
      ],
      pantryItems: [],
    };
    const result = aggregateShoppingItems(input);
    expect(result.find((r) => r.ingredientId === 100)?.quantityNeeded).toBe(1);
  });

  it("subtracts pantry on-hand from quantityToBuy without affecting quantityNeeded", () => {
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "batch_prep", servings: 4 })], // needs 2 lb of #100
      pantryItems: [
        { ingredientId: 100, quantity: 0.75 },
      ],
    };
    const result = aggregateShoppingItems(input);
    const item = result.find((r) => r.ingredientId === 100)!;
    expect(item.quantityNeeded).toBe(2);
    expect(item.quantityOnHand).toBe(0.75);
    expect(item.quantityToBuy).toBeCloseTo(1.25, 5);
  });

  it("clamps quantityToBuy at zero when on-hand exceeds need", () => {
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "cook_fresh" })], // needs 1 lb
      pantryItems: [{ ingredientId: 100, quantity: 5 }],
    };
    const result = aggregateShoppingItems(input);
    expect(result.find((r) => r.ingredientId === 100)?.quantityToBuy).toBe(0);
  });

  it("returns empty array when every planned meal is leftovers", () => {
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "leftovers" }), pm({ cookStyle: "leftovers" })],
      pantryItems: [],
    };
    expect(aggregateShoppingItems(input)).toEqual([]);
  });
});
