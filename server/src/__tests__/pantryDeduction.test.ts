import { describe, it, expect } from "vitest";
import { selectBatchesToDrain, type DrainPlan } from "../services/pantryService.js";

const batch = (over: any = {}) => ({
  id: 1,
  quantity: 1,
  unit: "lb",
  expirationDate: null as Date | null,
  tags: [] as string[],
  ...over,
});

describe("selectBatchesToDrain", () => {
  const ingredient = { defaultUnit: "lb", densityGPerMl: null, gramsPerCount: null };

  it("drains the soonest-expiring batch first (FEFO)", () => {
    const plan = selectBatchesToDrain({
      needed: 0.5,
      neededUnit: "lb",
      ingredient,
      batches: [
        batch({ id: 1, quantity: 1, expirationDate: new Date("2026-06-01Z") }),
        batch({ id: 2, quantity: 1, expirationDate: new Date("2026-05-10Z") }),
      ],
    });
    expect(plan.consumed.map((c) => c.batchId)).toEqual([2]);
    expect(plan.consumed[0].partial).toBe(true);
    expect(plan.consumed[0].newQuantity).toBeCloseTo(0.5, 5);
    expect(plan.shortfall).toBe(0);
  });

  it("use_first tag overrides FEFO", () => {
    const plan = selectBatchesToDrain({
      needed: 0.5,
      neededUnit: "lb",
      ingredient,
      batches: [
        batch({ id: 1, quantity: 1, expirationDate: new Date("2026-05-01Z") }),
        batch({ id: 2, quantity: 1, expirationDate: new Date("2026-06-01Z"), tags: ["use_first"] }),
      ],
    });
    expect(plan.consumed[0].batchId).toBe(2);
  });

  it("walks multiple batches when one isn't enough", () => {
    const plan = selectBatchesToDrain({
      needed: 1.5,
      neededUnit: "lb",
      ingredient,
      batches: [
        batch({ id: 1, quantity: 1, expirationDate: new Date("2026-05-01Z") }),
        batch({ id: 2, quantity: 1, expirationDate: new Date("2026-05-15Z") }),
      ],
    });
    expect(plan.consumed.map((c) => c.batchId)).toEqual([1, 2]);
    expect(plan.consumed[0].partial).toBe(false);
    expect(plan.consumed[1].partial).toBe(true);
    expect(plan.consumed[1].newQuantity).toBeCloseTo(0.5, 5);
  });

  it("converts units when batch unit differs from recipe unit", () => {
    const plan = selectBatchesToDrain({
      needed: 8,
      neededUnit: "oz",
      ingredient,
      batches: [batch({ id: 1, quantity: 1, unit: "lb" })],
    });
    expect(plan.consumed[0].batchId).toBe(1);
    expect(plan.consumed[0].newQuantity).toBeCloseTo(0.5, 5); // 1 lb - 8 oz = 0.5 lb
  });

  it("skips batches whose unit can't convert instead of double-charging", () => {
    // The brioche-bun bug: a 0.25-"package" batch (FEFO-first) and an 8-count
    // batch. Draining 2 count used to consume the package batch as 0.25 items
    // AND take 1.75 more from the count batch. The package batch must be
    // skipped; only the count batch drains.
    const plan = selectBatchesToDrain({
      needed: 2,
      neededUnit: "count",
      ingredient: { defaultUnit: "count", densityGPerMl: null, gramsPerCount: null },
      batches: [
        batch({ id: 1, quantity: 0.25, unit: "package", expirationDate: new Date("2026-05-01Z") }),
        batch({ id: 2, quantity: 8, unit: "count", expirationDate: null }),
      ],
    });
    expect(plan.consumed).toEqual([{ batchId: 2, partial: true, newQuantity: 6 }]);
    expect(plan.shortfall).toBe(0);
  });

  it("rethrows the conversion error when no batch is compatible at all", () => {
    // Preserves the caller's "no_density"-style shortfall reporting: if the
    // need couldn't touch ANY batch for conversion reasons, that's a
    // conversion problem, not an insufficient-stock problem.
    expect(() =>
      selectBatchesToDrain({
        needed: 2,
        neededUnit: "count",
        ingredient: { defaultUnit: "count", densityGPerMl: null, gramsPerCount: null },
        batches: [batch({ id: 1, quantity: 0.25, unit: "package" })],
      }),
    ).toThrow();
  });

  it("reports a shortfall when compatible batches run out and incompatible ones remain", () => {
    const plan = selectBatchesToDrain({
      needed: 5,
      neededUnit: "count",
      ingredient: { defaultUnit: "count", densityGPerMl: null, gramsPerCount: null },
      batches: [
        batch({ id: 1, quantity: 0.25, unit: "package" }),
        batch({ id: 2, quantity: 3, unit: "count" }),
      ],
    });
    expect(plan.consumed).toEqual([{ batchId: 2, partial: false, newQuantity: 0 }]);
    expect(plan.shortfall).toBe(2);
  });

  it("drains across package and count batches when the package size is known", () => {
    // With purchaseUnitQty = 8 (a package holds 8 buns), the 0.25-package
    // batch is worth 2 buns: a 10-bun need drains it fully plus all 8 loose.
    const plan = selectBatchesToDrain({
      needed: 10,
      neededUnit: "count",
      ingredient: { defaultUnit: "count", densityGPerMl: null, gramsPerCount: null, purchaseUnitQty: 8 },
      batches: [
        batch({ id: 1, quantity: 0.25, unit: "package", expirationDate: new Date("2026-05-01Z") }),
        batch({ id: 2, quantity: 8, unit: "count", expirationDate: null }),
      ],
    });
    expect(plan.consumed).toEqual([
      { batchId: 1, partial: false, newQuantity: 0 },
      { batchId: 2, partial: false, newQuantity: 0 },
    ]);
    expect(plan.shortfall).toBe(0);
  });

  it("returns shortfall when pantry can't cover", () => {
    const plan = selectBatchesToDrain({
      needed: 5,
      neededUnit: "lb",
      ingredient,
      batches: [batch({ id: 1, quantity: 1 })],
    });
    expect(plan.consumed.map((c) => c.batchId)).toEqual([1]);
    expect(plan.shortfall).toBeCloseTo(4, 5);
    expect(plan.shortfallUnit).toBe("lb");
  });
});
