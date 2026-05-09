import { describe, it, expect } from "vitest";
import { aggregateCards, type AggregateCardsInput } from "../services/pantryAggregation.js";

const ing = (over: Partial<AggregateCardsInput["ingredients"][number]> = {}) => ({
  id: 1,
  name: "Milk",
  category: "dairy" as const,
  defaultUnit: "gal",
  defaultLocation: "fridge" as const,
  densityGPerMl: null,
  gramsPerCount: null,
  shelfLifeFridgeDays: 10,
  shelfLifeFreezerDays: null,
  shelfLifePantryDays: null,
  lowStockThreshold: 1,
  lowStockUnit: "gal",
  isOneOff: false,
  ...over,
});

const batch = (over: Partial<AggregateCardsInput["batches"][number]> = {}) => ({
  id: 100,
  ingredientId: 1,
  quantity: 1,
  unit: "gal",
  location: "fridge" as const,
  expirationDate: null,
  purchaseDate: null,
  costAtPurchase: null,
  tags: [],
  receiptItemId: null,
  consumedAt: null,
  createdAt: new Date("2026-05-01T00:00:00Z"),
  updatedAt: new Date("2026-05-01T00:00:00Z"),
  ...over,
});

describe("aggregateCards", () => {
  it("groups batches by ingredient and sums same-unit quantities", () => {
    const result = aggregateCards({
      ingredients: [ing()],
      batches: [
        batch({ id: 100, quantity: 1, unit: "gal" }),
        batch({ id: 101, quantity: 0.5, unit: "gal" }),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].batchCount).toBe(2);
    expect(result[0].totalsByUnit).toEqual([{ unit: "gal", qty: 1.5 }]);
    expect(result[0].canonicalTotal).toEqual({ qty: 1.5, unit: "gal" });
    expect(result[0].partialTotal).toBe(false);
  });

  it("returns soonestExpiration as min of batches", () => {
    const result = aggregateCards({
      ingredients: [ing()],
      batches: [
        batch({ id: 100, expirationDate: new Date("2026-05-15T00:00:00Z") }),
        batch({ id: 101, expirationDate: new Date("2026-05-08T00:00:00Z") }),
      ],
    });
    expect(result[0].soonestExpiration).toEqual(new Date("2026-05-08T00:00:00Z"));
  });

  it("isLowStock=true when canonical total below threshold", () => {
    const result = aggregateCards({
      ingredients: [ing({ lowStockThreshold: 1, lowStockUnit: "gal" })],
      batches: [batch({ quantity: 0.25, unit: "gal" })],
    });
    expect(result[0].isLowStock).toBe(true);
  });

  it("isLowStock=false when threshold not set", () => {
    const result = aggregateCards({
      ingredients: [ing({ lowStockThreshold: null, lowStockUnit: null })],
      batches: [batch()],
    });
    expect(result[0].isLowStock).toBe(false);
  });

  it("partialTotal=true when a batch can't convert to defaultUnit", () => {
    // Milk default gal, one batch in cups, no density set => partial.
    const result = aggregateCards({
      ingredients: [ing({ densityGPerMl: null })],
      batches: [
        batch({ quantity: 0.5, unit: "gal" }),
        batch({ id: 102, quantity: 200, unit: "g" }),
      ],
    });
    expect(result[0].partialTotal).toBe(true);
    // canonicalTotal includes only the convertible batch.
    expect(result[0].canonicalTotal?.qty).toBeCloseTo(0.5, 5);
  });

  it("excludes consumed (soft-deleted) batches", () => {
    const result = aggregateCards({
      ingredients: [ing()],
      batches: [
        batch({ id: 100, quantity: 1, consumedAt: null }),
        batch({ id: 101, quantity: 1, consumedAt: new Date("2026-05-01T00:00:00Z") }),
      ],
    });
    expect(result[0].batchCount).toBe(1);
    expect(result[0].totalsByUnit).toEqual([{ unit: "gal", qty: 1 }]);
  });

  it("orders batches FEFO with use_first first", () => {
    const result = aggregateCards({
      ingredients: [ing()],
      batches: [
        batch({ id: 100, expirationDate: new Date("2026-05-15Z") }),
        batch({ id: 101, expirationDate: new Date("2026-05-10Z"), tags: ["use_first"] }),
        batch({ id: 102, expirationDate: new Date("2026-05-05Z") }),
      ],
    });
    expect(result[0].batches.map((b) => b.id)).toEqual([101, 102, 100]);
  });

  it("ingredient with zero active batches still appears (with empty totals)", () => {
    const result = aggregateCards({
      ingredients: [ing()],
      batches: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].batchCount).toBe(0);
    expect(result[0].totalsByUnit).toEqual([]);
    expect(result[0].canonicalTotal).toBeNull();
    expect(result[0].soonestExpiration).toBeNull();
  });
});
