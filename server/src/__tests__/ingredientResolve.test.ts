import { describe, it, expect } from "vitest";
import { resolveIngredientId } from "../services/ingredientResolve.js";

const existing = [
  { id: 1, name: "tomato" },
  { id: 2, name: "chicken thigh" },
];

describe("resolveIngredientId (pure)", () => {
  it("returns an alias target first", () => {
    const aliasMap = new Map<string, number>([["diced tomato", 1]]);
    expect(resolveIngredientId("diced tomato", existing, aliasMap)).toEqual({ id: 1, source: "alias" });
  });

  it("returns a confident fuzzy match", () => {
    // "organic" is a known descriptor → after noise removal only "tomato" → high.
    expect(resolveIngredientId("organic tomato", existing, new Map())).toEqual({ id: 1, source: "fuzzy" });
  });

  it("returns null when nothing matches confidently", () => {
    expect(resolveIngredientId("saffron", existing, new Map())).toBeNull();
  });

  it("a low-confidence fuzzy match is treated as no match (caller creates new)", () => {
    // "diced tomato" has the extra content word "diced" → low confidence → null.
    expect(resolveIngredientId("diced tomato", existing, new Map())).toBeNull();
  });
});
