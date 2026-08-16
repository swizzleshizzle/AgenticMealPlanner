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
    const result = aggregateShoppingItems(input).items;
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
    const result = aggregateShoppingItems(input).items;
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
    const item = result.items.find((r) => r.ingredientId === 100)!;
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
    const result = aggregateShoppingItems(input).items;
    expect(result.find((r) => r.ingredientId === 100)?.quantityToBuy).toBe(0);
  });

  it("returns empty array when every planned meal is leftovers", () => {
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "leftovers" }), pm({ cookStyle: "leftovers" })],
      pantryItems: [],
      ingredients: META,
    };
    expect(aggregateShoppingItems(input).items).toEqual([]);
  });

  it("converts pantry on-hand to the ingredient's default unit before subtracting", () => {
    // Need 1 lb of #100; on hand 8 oz = 0.5 lb → buy 0.5 lb.
    const input: AggregateInput = {
      plannedMeals: [pm({ cookStyle: "cook_fresh" })],
      pantryItems: [{ ingredientId: 100, quantity: 8, unit: "oz" }],
      ingredients: META,
    };
    const item = aggregateShoppingItems(input).items.find((r) => r.ingredientId === 100)!;
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
    const item = aggregateShoppingItems(input).items.find((r) => r.ingredientId === 101)!;
    expect(item.quantityNeeded).toBe(0.5);
    expect(item.quantityOnHand).toBe(0); // 200 g was NOT added as a bare number
    expect(item.quantityToBuy).toBe(0.5);
    expect(item.partial).toBe(true);
  });
});

describe("aggregateShoppingItems — alias canonicalization", () => {
  // "chicken cutlet" (300) is an alias of "chicken breast" (301): needs and
  // on-hand for either id must pool under the canonical id (301).
  const ALIAS_META: AggregateInput["ingredients"] = [
    { id: 300, defaultUnit: "oz" },
    { id: 301, defaultUnit: "oz" },
  ];
  const canonicalIds = new Map([[300, 301]]);

  function mealNeeding(ingredientId: number, quantity: number, unit = "oz"): AggregateInput["plannedMeals"][number] {
    return {
      cookStyle: "cook_fresh",
      servings: 2,
      meal: { servings: 2, ingredients: [{ ingredientId, quantity, unit }] },
    };
  }

  it("credits pantry stock of the canonical ingredient against an aliased need", () => {
    const result = aggregateShoppingItems({
      plannedMeals: [mealNeeding(300, 42)], // recipe says "chicken cutlet"
      pantryItems: [{ ingredientId: 301, quantity: 1.25, unit: "lb" }], // fridge has breast
      ingredients: ALIAS_META,
      canonicalIds,
    });
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.ingredientId).toBe(301); // reported under the canonical ingredient
    expect(item.quantityNeeded).toBeCloseTo(42, 5);
    expect(item.quantityOnHand).toBeCloseTo(20, 5); // 1.25 lb = 20 oz
    expect(item.quantityToBuy).toBeCloseTo(22, 5);
  });

  it("pools needs from alias and canonical ingredients into one line", () => {
    const result = aggregateShoppingItems({
      plannedMeals: [mealNeeding(300, 12), mealNeeding(301, 10)],
      pantryItems: [],
      ingredients: ALIAS_META,
      canonicalIds,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].ingredientId).toBe(301);
    expect(result.items[0].quantityNeeded).toBeCloseTo(22, 5);
  });

  it("uses the canonical ingredient's conversion metadata", () => {
    // Alias id 300 has no meta of its own beyond oz; the canonical target's
    // defaultUnit (lb here) must win for the combined line.
    const result = aggregateShoppingItems({
      plannedMeals: [mealNeeding(300, 16, "oz")],
      pantryItems: [],
      ingredients: [{ id: 301, defaultUnit: "lb" }],
      canonicalIds,
    });
    expect(result.items[0].ingredientId).toBe(301);
    expect(result.items[0].unit).toBe("lb");
    expect(result.items[0].quantityNeeded).toBeCloseTo(1, 5);
  });

  it("routes descriptor-unit staples through the canonical id", () => {
    const result = aggregateShoppingItems({
      plannedMeals: [mealNeeding(300, 1, "to taste")],
      pantryItems: [],
      ingredients: ALIAS_META,
      canonicalIds,
    });
    expect(result.staples).toEqual([301]);
  });
});

describe("aggregateShoppingItems — staples & estimates", () => {
  const SALT_META: AggregateInput["ingredients"] = [{ id: 200, defaultUnit: "tsp" }];

  function stapleMeal(unit: string): AggregateInput["plannedMeals"][number] {
    return {
      cookStyle: "cook_fresh",
      servings: 2,
      meal: { servings: 2, ingredients: [{ ingredientId: 200, quantity: 1, unit }] },
    };
  }

  it("routes a descriptor-only ingredient to staples, not a numeric line", () => {
    const res = aggregateShoppingItems({
      plannedMeals: [stapleMeal("to taste")],
      pantryItems: [],
      ingredients: SALT_META,
    });
    expect(res.items).toEqual([]);
    expect(res.staples).toEqual([200]);
  });

  it("keeps an ingredient numeric (no staple) when it also has a real unit", () => {
    const res = aggregateShoppingItems({
      plannedMeals: [stapleMeal("tsp"), stapleMeal("to taste")],
      pantryItems: [],
      ingredients: SALT_META,
    });
    expect(res.staples).toEqual([]);
    const salt = res.items.find((r) => r.ingredientId === 200)!;
    expect(salt.quantityNeeded).toBe(1);
  });

  it("marks an unconvertible real unit as an estimate (need 0, partial)", () => {
    const res = aggregateShoppingItems({
      plannedMeals: [stapleMeal("sprig")], // 'sprig' is unknown, not a descriptor
      pantryItems: [],
      ingredients: SALT_META,
    });
    const est = res.items.find((r) => r.ingredientId === 200)!;
    expect(est.quantityNeeded).toBe(0);
    expect(est.partial).toBe(true);
    expect(res.staples).toEqual([]);
  });

  it("counts a 'whole' onion need and subtracts count pantry stock", () => {
    const ONION: AggregateInput["ingredients"] = [{ id: 5, defaultUnit: "count" }];
    const res = aggregateShoppingItems({
      plannedMeals: [
        { cookStyle: "cook_fresh", servings: 2, meal: { servings: 2, ingredients: [{ ingredientId: 5, quantity: 1, unit: "whole" }] } },
        { cookStyle: "cook_fresh", servings: 2, meal: { servings: 2, ingredients: [{ ingredientId: 5, quantity: 1, unit: "whole" }] } },
      ],
      pantryItems: [],
      ingredients: ONION,
    });
    const onion = res.items.find((r) => r.ingredientId === 5)!;
    expect(onion.quantityNeeded).toBe(2);
    expect(onion.quantityToBuy).toBe(2);
    expect(onion.partial).toBe(false);
  });
});
