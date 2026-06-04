import { describe, it, expect } from "vitest";
import { buildCookPreview, type PantryCardLite, type CookPreviewInputLine } from "../services/cookPreview.js";

function card(over: Partial<PantryCardLite> & { ingredientId: number; name: string }): PantryCardLite {
  return {
    ingredientId: over.ingredientId,
    name: over.name,
    category: over.category ?? "other",
    defaultUnit: over.defaultUnit ?? "g",
    densityGPerMl: over.densityGPerMl ?? null,
    gramsPerCount: over.gramsPerCount ?? null,
    batches: over.batches ?? [{ id: 1, quantity: 500, unit: "g", expirationDate: null, tags: [] }],
    totalsByUnit: over.totalsByUnit ?? [{ unit: "g", qty: 500 }],
  };
}

const line = (o: Partial<CookPreviewInputLine> & { ingredientId: number; name: string }): CookPreviewInputLine => ({
  ingredientId: o.ingredientId,
  name: o.name,
  quantity: o.quantity ?? 1,
  unit: o.unit ?? "g",
});

describe("buildCookPreview", () => {
  it("exact: same-unit match deducts the requested amount, included, no flag", () => {
    const cards = [card({ ingredientId: 10, name: "chicken thigh", batches: [{ id: 1, quantity: 800, unit: "g", expirationDate: null, tags: [] }], totalsByUnit: [{ unit: "g", qty: 800 }] })];
    const [p] = buildCookPreview([line({ ingredientId: 10, name: "chicken thigh", quantity: 200, unit: "g" })], cards);
    expect(p.confidence).toBe("exact");
    expect(p.matchedIngredientId).toBe(10);
    expect(p.matchSource).toBe("id");
    expect(p.deductQuantity).toBeCloseTo(200, 5);
    expect(p.deductUnit).toBe("g");
    expect(p.included).toBe(true);
    expect(p.projectedRemaining).toEqual({ qty: 600, unit: "g" });
  });

  it("exact: same-family cross-unit (tbsp->ml is volume->volume) needs no density", () => {
    const cards = [card({ ingredientId: 11, name: "olive oil", defaultUnit: "ml", batches: [{ id: 2, quantity: 500, unit: "ml", expirationDate: null, tags: [] }], totalsByUnit: [{ unit: "ml", qty: 500 }] })];
    const [p] = buildCookPreview([line({ ingredientId: 11, name: "olive oil", quantity: 2, unit: "tbsp" })], cards);
    expect(p.confidence).toBe("exact");
    expect(p.deductUnit).toBe("ml");
    expect(p.deductQuantity).toBeCloseTo(29.5736, 3); // 2 * 14.7868
  });

  it("converted: cross-family with density present is computed but flagged", () => {
    const cards = [card({ ingredientId: 12, name: "honey", defaultUnit: "g", densityGPerMl: 1.4, batches: [{ id: 3, quantity: 300, unit: "g", expirationDate: null, tags: [] }], totalsByUnit: [{ unit: "g", qty: 300 }] })];
    const [p] = buildCookPreview([line({ ingredientId: 12, name: "honey", quantity: 30, unit: "ml" })], cards);
    expect(p.confidence).toBe("converted");
    expect(p.deductUnit).toBe("g");
    expect(p.deductQuantity).toBeCloseTo(42, 5); // 30ml * 1.4 g/ml
  });

  it("estimated: cross-family, no density -> coarse category guess, flagged", () => {
    const cards = [card({ ingredientId: 13, name: "garlic", category: "produce", defaultUnit: "count", batches: [{ id: 4, quantity: 1, unit: "bulb", expirationDate: null, tags: [] }], totalsByUnit: [{ unit: "bulb", qty: 1 }] })];
    const [p] = buildCookPreview([line({ ingredientId: 13, name: "garlic", quantity: 3, unit: "tbsp" })], cards);
    expect(p.confidence).toBe("estimated");
    expect(p.deductUnit).toBe("bulb");
    expect(p.deductQuantity).toBeCloseTo(0.25, 5); // produce default fraction
  });

  it("fuzzy match by name resolves to a different pantry ingredient id", () => {
    const cards = [card({ ingredientId: 20, name: "tomato", batches: [{ id: 5, quantity: 400, unit: "g", expirationDate: null, tags: [] }], totalsByUnit: [{ unit: "g", qty: 400 }] })];
    const [p] = buildCookPreview([line({ ingredientId: 99, name: "diced tomato", quantity: 100, unit: "g" })], cards);
    expect(p.matchedIngredientId).toBe(20);
    expect(p.matchedName).toBe("tomato");
    expect(p.matchSource).toBe("fuzzy");
    // "diced tomato" → "tomato" is a LOW-confidence fuzzy hit ("diced" is an
    // extra content word), so it surfaces matched-but-flagged for review.
    expect(p.confidence).toBe("estimated");
  });

  it("high-confidence fuzzy match (descriptor-only extra token) keeps the conversion tier", () => {
    const cards = [card({ ingredientId: 22, name: "tomato", batches: [{ id: 8, quantity: 400, unit: "g", expirationDate: null, tags: [] }], totalsByUnit: [{ unit: "g", qty: 400 }] })];
    // "organic" is a known descriptor, so after noise removal only "tomato"
    // remains → high-confidence fuzzy → confidence follows the (exact) conversion.
    const [p] = buildCookPreview([line({ ingredientId: 97, name: "organic tomato", quantity: 100, unit: "g" })], cards);
    expect(p.matchSource).toBe("fuzzy");
    expect(p.matchedIngredientId).toBe(22);
    expect(p.confidence).toBe("exact");
  });

  it("low-confidence fuzzy match is downgraded to estimated even when units align", () => {
    const cards = [card({ ingredientId: 21, name: "milk", batches: [{ id: 6, quantity: 1000, unit: "ml", expirationDate: null, tags: [] }], totalsByUnit: [{ unit: "ml", qty: 1000 }] })];
    // "milk chocolate bar" matches the "milk" candidate as an adjective -> low confidence.
    const [p] = buildCookPreview([line({ ingredientId: 98, name: "milk chocolate bar", quantity: 50, unit: "ml" })], cards);
    expect(p.matchSource).toBe("fuzzy");
    expect(p.confidence).toBe("estimated");
  });

  it("no match: nothing in pantry resolves -> none, not included, pantry untouched", () => {
    const cards = [card({ ingredientId: 30, name: "basmati rice" })];
    const [p] = buildCookPreview([line({ ingredientId: 31, name: "saffron", quantity: 1, unit: "g" })], cards);
    expect(p.confidence).toBe("none");
    expect(p.matchedIngredientId).toBeNull();
    expect(p.matchSource).toBe("none");
    expect(p.included).toBe(false);
  });

  it("preserves source identity for display/commit", () => {
    const cards = [card({ ingredientId: 20, name: "tomato" })];
    const [p] = buildCookPreview([line({ ingredientId: 99, name: "diced tomato", quantity: 100, unit: "g" })], cards);
    expect(p.sourceIngredientId).toBe(99);
    expect(p.name).toBe("diced tomato");
    expect(p.requestedQuantity).toBe(100);
    expect(p.requestedUnit).toBe("g");
  });

  it("alias map resolves a line to its canonical pantry ingredient as exact", () => {
    const cards = [card({ ingredientId: 40, name: "tomato", batches: [{ id: 7, quantity: 400, unit: "g", expirationDate: null, tags: [] }], totalsByUnit: [{ unit: "g", qty: 400 }] })];
    const aliasMap = new Map<string, number>([["diced tomato", 40]]);
    const [p] = buildCookPreview([line({ ingredientId: 99, name: "diced tomato", quantity: 100, unit: "g" })], cards, aliasMap);
    expect(p.matchSource).toBe("alias");
    expect(p.matchedIngredientId).toBe(40);
    expect(p.confidence).toBe("exact");
  });
});
