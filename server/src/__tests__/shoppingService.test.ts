import { describe, it, expect } from "vitest";
import { aggregateShoppingItems, type AggregateInput } from "../services/shoppingService.js";

// Ingredient 100 is measured in lb, 101 in cup.
const META: AggregateInput["ingredients"] = [
  { id: 100, defaultUnit: "lb" },
  { id: 101, defaultUnit: "cup" },
];

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
      ingredients: META,
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
      ingredients: META,
    };
    const result = aggregateShoppingItems(input);
    expect(result.find((r) => r.ingredientId === 100)?.quantityNeeded).toBe(1);
  });

  it("subtracts pantry on-hand from quantityToBuy without affecting quantityNeeded", () => {
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "batch_prep", servings: 4 })], // needs 2 lb of #100
      pantryItems: [
        { ingredientId: 100, quantity: 0.75, unit: "lb" },
      ],
      ingredients: META,
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
      pantryItems: [{ ingredientId: 100, quantity: 5, unit: "lb" }],
      ingredients: META,
    };
    const result = aggregateShoppingItems(input);
    expect(result.find((r) => r.ingredientId === 100)?.quantityToBuy).toBe(0);
  });

  it("returns empty array when every planned meal is leftovers", () => {
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "leftovers" }), pm({ cookStyle: "leftovers" })],
      pantryItems: [],
      ingredients: META,
    };
    expect(aggregateShoppingItems(input)).toEqual([]);
  });

  it("converts pantry on-hand to the ingredient's default unit before subtracting", () => {
    // Need 1 lb of #100; on hand 8 oz = 0.5 lb → buy 0.5 lb.
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "cook_fresh" })],
      pantryItems: [{ ingredientId: 100, quantity: 8, unit: "oz" }],
      ingredients: META,
    };
    const item = aggregateShoppingItems(input).find((r) => r.ingredientId === 100)!;
    expect(item.unit).toBe("lb");
    expect(item.quantityOnHand).toBeCloseTo(0.5, 5);
    expect(item.quantityToBuy).toBeCloseTo(0.5, 5);
    expect(item.partial).toBe(false);
  });

  it("flags partial and skips on-hand it cannot convert instead of mis-summing", () => {
    // Need 0.5 cup of #101 (volume); on hand is in grams (mass) with no density
    // hint, so it cannot be converted — it must be skipped, not added raw.
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "cook_fresh" })],
      pantryItems: [{ ingredientId: 101, quantity: 200, unit: "g" }],
      ingredients: META, // #101 has no densityGPerMl
    };
    const item = aggregateShoppingItems(input).find((r) => r.ingredientId === 101)!;
    expect(item.quantityNeeded).toBe(0.5);
    expect(item.quantityOnHand).toBe(0); // 200 g was NOT added as a bare number
    expect(item.quantityToBuy).toBe(0.5);
    expect(item.partial).toBe(true);
  });
});
