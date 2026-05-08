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
