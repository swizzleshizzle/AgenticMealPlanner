import { describe, it, expect } from "vitest";
import { computeMergeDecision, weeklyWindow } from "../services/receiptService.js";

describe("computeMergeDecision", () => {
  const baseExisting = [
    { id: 10, ingredientId: 1, quantity: 0.5, unit: "gal", location: "fridge", expirationDate: new Date("2026-05-15") },
    { id: 11, ingredientId: 2, quantity: 1,   unit: "count", location: "pantry", expirationDate: null },
  ];

  it("merges when ingredient + unit + location all match", () => {
    const result = computeMergeDecision(
      { ingredientId: 1, quantity: 1, unit: "gal", location: "fridge", expirationDate: null },
      baseExisting,
    );
    expect(result).toEqual({
      action: "increment",
      pantryItemId: 10,
      newQuantity: 1.5,
      newExpirationDate: new Date("2026-05-15"),
    });
  });

  it("creates a new row when units differ", () => {
    const result = computeMergeDecision(
      { ingredientId: 1, quantity: 32, unit: "oz", location: "fridge", expirationDate: null },
      baseExisting,
    );
    expect(result).toEqual({ action: "create" });
  });

  it("creates a new row when location differs", () => {
    const result = computeMergeDecision(
      { ingredientId: 1, quantity: 1, unit: "gal", location: "freezer", expirationDate: null },
      baseExisting,
    );
    expect(result).toEqual({ action: "create" });
  });

  it("creates a new row when no existing item matches", () => {
    const result = computeMergeDecision(
      { ingredientId: 99, quantity: 1, unit: "count", location: "pantry", expirationDate: null },
      baseExisting,
    );
    expect(result).toEqual({ action: "create" });
  });

  it("FIFO bias: receipt expiration earlier than existing → adopt the earlier date", () => {
    const result = computeMergeDecision(
      { ingredientId: 1, quantity: 1, unit: "gal", location: "fridge", expirationDate: new Date("2026-05-10") },
      baseExisting,
    );
    expect(result.action).toBe("increment");
    if (result.action === "increment") {
      expect(result.newExpirationDate).toEqual(new Date("2026-05-10"));
    }
  });

  it("FIFO bias: receipt expiration later than existing → keep the existing date", () => {
    const result = computeMergeDecision(
      { ingredientId: 1, quantity: 1, unit: "gal", location: "fridge", expirationDate: new Date("2026-05-20") },
      baseExisting,
    );
    expect(result.action).toBe("increment");
    if (result.action === "increment") {
      expect(result.newExpirationDate).toEqual(new Date("2026-05-15"));
    }
  });

  it("merges into a row whose existing expiration is null", () => {
    const result = computeMergeDecision(
      { ingredientId: 2, quantity: 2, unit: "count", location: "pantry", expirationDate: new Date("2026-05-15") },
      baseExisting,
    );
    expect(result).toEqual({
      action: "increment",
      pantryItemId: 11,
      newQuantity: 3,
      newExpirationDate: new Date("2026-05-15"),
    });
  });
});

describe("weeklyWindow", () => {
  it("returns Sunday → Saturday for a midweek date", () => {
    // 2026-05-06 is a Wednesday
    const { weekStart, weekEnd } = weeklyWindow(new Date("2026-05-06T12:00:00"));
    expect(weekStart.toISOString().slice(0, 10)).toBe("2026-05-03"); // Sunday
    expect(weekEnd.toISOString().slice(0, 10)).toBe("2026-05-09");   // Saturday
  });

  it("returns same Sunday for a Sunday input", () => {
    const { weekStart } = weeklyWindow(new Date("2026-05-03T12:00:00"));
    expect(weekStart.toISOString().slice(0, 10)).toBe("2026-05-03");
  });

  it("returns Saturday's week (not next week's) for a Saturday input", () => {
    const { weekStart, weekEnd } = weeklyWindow(new Date("2026-05-09T23:00:00"));
    expect(weekStart.toISOString().slice(0, 10)).toBe("2026-05-03");
    expect(weekEnd.toISOString().slice(0, 10)).toBe("2026-05-09");
  });
});
