import { describe, it, expect } from "vitest";
import { expandAbbreviations, fuzzyMatchIngredient } from "../claude/ingredientMatcher.js";

describe("expandAbbreviations", () => {
  it("expands single abbreviation", () => {
    expect(expandAbbreviations("ORG SPINACH")).toBe("organic spinach");
  });

  it("expands multiple abbreviations in one phrase", () => {
    expect(expandAbbreviations("ORG WHL MILK 1G")).toBe("organic whole milk 1g");
  });

  it("is case-insensitive on input but lowercases the output", () => {
    expect(expandAbbreviations("Org Bnn")).toBe("organic banana");
  });

  it("leaves words it doesn't recognize alone", () => {
    expect(expandAbbreviations("HAM CRUSTED")).toBe("ham crusted");
  });

  it("handles empty input", () => {
    expect(expandAbbreviations("")).toBe("");
  });

  it("strips punctuation that splits abbreviations", () => {
    expect(expandAbbreviations("ORG. SPNCH,5OZ")).toBe("organic spinach 5oz");
  });
});

describe("fuzzyMatchIngredient", () => {
  const candidates = [
    { id: 1, name: "spinach" },
    { id: 2, name: "whole milk" },
    { id: 3, name: "great value bread" },
    { id: 4, name: "banana" },
    { id: 5, name: "milk" },
  ];

  it("exact match returns high confidence", () => {
    const result = fuzzyMatchIngredient("spinach", candidates);
    expect(result).toEqual({ id: 1, name: "spinach", confidence: "high" });
  });

  it("contains match returns high confidence", () => {
    const result = fuzzyMatchIngredient("organic spinach 5oz", candidates);
    expect(result?.id).toBe(1);
    expect(result?.confidence).toBe("high");
  });

  it("matches after abbreviation expansion", () => {
    const result = fuzzyMatchIngredient("ORG SPNCH", candidates);
    expect(result?.id).toBe(1);
  });

  it("matches multi-word ingredient with extra adjectives", () => {
    const result = fuzzyMatchIngredient("ORG WHL MILK 1G", candidates);
    expect(result?.id).toBe(2);
  });

  it("returns null when nothing matches", () => {
    const result = fuzzyMatchIngredient("oxtail bouillon cubes", candidates);
    expect(result).toBeNull();
  });

  it("flags borderline single-token matches as low confidence", () => {
    const result = fuzzyMatchIngredient("milk chocolate bar", candidates);
    // matches 'whole milk' on the 'milk' substring but the input is unrelated
    // → confidence should be 'low'
    expect(result?.confidence).toBe("low");
  });

  it("plural / singular tolerance: 'bananas' matches 'banana'", () => {
    const result = fuzzyMatchIngredient("bananas", candidates);
    expect(result?.id).toBe(4);
  });
});
