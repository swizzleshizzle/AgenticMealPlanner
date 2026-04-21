import { describe, it, expect } from "vitest";
import { resolveCapabilityWrite } from "../services/mealService.js";

describe("resolveCapabilityWrite", () => {
  it("defaults to canFresh=true, canBatch=false when neither flag is passed and no existing row", () => {
    expect(resolveCapabilityWrite({}, null)).toEqual({
      canBatch: false,
      canFresh: true,
      mealType: "cook_fresh",
    });
  });

  it("batch-only input produces mealType=batch_prep", () => {
    expect(resolveCapabilityWrite({ canBatch: true, canFresh: false }, null)).toEqual({
      canBatch: true,
      canFresh: false,
      mealType: "batch_prep",
    });
  });

  it("both-capable input produces mealType=cook_fresh (historical primary)", () => {
    expect(resolveCapabilityWrite({ canBatch: true, canFresh: true }, null)).toEqual({
      canBatch: true,
      canFresh: true,
      mealType: "cook_fresh",
    });
  });

  it("partial update (canBatch only) falls back to existing canFresh", () => {
    const existing = { canBatch: false, canFresh: true };
    expect(resolveCapabilityWrite({ canBatch: true }, existing)).toEqual({
      canBatch: true,
      canFresh: true,
      mealType: "cook_fresh",
    });
  });

  it("flipping to batch-only via update recomputes mealType", () => {
    const existing = { canBatch: false, canFresh: true };
    expect(resolveCapabilityWrite({ canBatch: true, canFresh: false }, existing)).toEqual({
      canBatch: true,
      canFresh: false,
      mealType: "batch_prep",
    });
  });

  it("returns null when the update touches neither flag and no existing row is required", () => {
    expect(resolveCapabilityWrite({}, { canBatch: true, canFresh: false })).toBeNull();
  });
});
