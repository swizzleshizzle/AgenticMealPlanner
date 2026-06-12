// client/src/lib/ingredientSearch.test.ts
import { describe, it, expect } from "vitest";
import { filterIngredients, recomputeExpiration } from "./ingredientSearch";
import type { Ingredient } from "../api/ingredients";

const ing = (id: number, name: string, overrides?: Partial<Ingredient>): Ingredient => ({
  id,
  name,
  category: "other",
  defaultUnit: "count",
  defaultLocation: null,
  densityGPerMl: null,
  gramsPerCount: null,
  shelfLifeFridgeDays: null,
  shelfLifeFreezerDays: null,
  shelfLifePantryDays: null,
  lowStockThreshold: null,
  lowStockUnit: null,
  isOneOff: false,
  ...overrides,
});

const PANTRY: Ingredient[] = [
  ing(1, "cheddar cheese"),
  ing(2, "cream cheese"),
  ing(3, "chicken breast"),
  ing(4, "chicken stock"),
  ing(5, "rice"),
  ing(6, "brown rice"),
  ing(7, "rice vinegar"),
  ing(8, "milk"),
  ing(9, "almond milk"),
  ing(10, "oat milk"),
  ing(11, "butter"),
  ing(12, "peanut butter"),
  ing(13, "almond butter"),
  ing(14, "salt"),
];

describe("filterIngredients", () => {
  it("returns the first 12 ingredients in list order for an empty query", () => {
    const result = filterIngredients("", PANTRY);
    expect(result).toHaveLength(12);
    expect(result[0].name).toBe("cheddar cheese");
    expect(result[11].name).toBe("peanut butter");
  });

  it("is typo-tolerant (fuzzy): 'chedar' finds 'cheddar cheese'", () => {
    const names = filterIngredients("chedar", PANTRY).map((i) => i.name);
    expect(names).toContain("cheddar cheese");
  });

  it("ranks closer matches first: exact-ish 'rice' beats 'rice vinegar'", () => {
    const names = filterIngredients("rice", PANTRY).map((i) => i.name);
    expect(names[0]).toBe("rice");
  });

  it("caps fuzzy results at 12 even when more ingredients match", () => {
    const milks = Array.from({ length: 14 }, (_, i) => ing(100 + i, `milk ${i + 1}`));
    expect(filterIngredients("milk", milks)).toHaveLength(12);
  });

  it("returns empty array when nothing is close", () => {
    expect(filterIngredients("zzzzqqqq", PANTRY)).toEqual([]);
  });
});

describe("recomputeExpiration", () => {
  const milk = ing(8, "milk", {
    shelfLifeFridgeDays: 7,
    shelfLifeFreezerDays: 90,
    shelfLifePantryDays: null,
  });

  it("adds the fridge shelf life to the trip date", () => {
    expect(recomputeExpiration("2026-06-08", "fridge", milk)).toBe("2026-06-15");
  });

  it("adds the freezer shelf life to the trip date", () => {
    expect(recomputeExpiration("2026-06-08", "freezer", milk)).toBe("2026-09-06");
  });

  it("returns null when the ingredient has no shelf life for that location", () => {
    expect(recomputeExpiration("2026-06-08", "pantry", milk)).toBeNull();
  });

  it("adds the pantry shelf life to the trip date", () => {
    const rice = ing(20, "rice", { shelfLifePantryDays: 30 });
    expect(recomputeExpiration("2026-06-08", "pantry", rice)).toBe("2026-07-08");
  });

  it("returns null for a null location", () => {
    expect(recomputeExpiration("2026-06-08", null, milk)).toBeNull();
  });

  it("returns null for an unparseable trip date", () => {
    expect(recomputeExpiration("not-a-date", "fridge", milk)).toBeNull();
  });
});
