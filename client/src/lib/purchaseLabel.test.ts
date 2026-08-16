import { describe, it, expect } from "vitest";
import { purchaseLabel } from "./purchaseLabel";

describe("purchaseLabel", () => {
  it("converts a recipe-unit amount into whole retail units with the precise amount as detail", () => {
    // 42 oz of chicken cutlets, sold as 1-lb (16 oz) packs → grab 3 packs.
    expect(purchaseLabel(42, "oz", { purchaseUnitName: "1-lb pack", purchaseUnitQty: 16 }))
      .toEqual({ main: "3 × 1-lb pack", detail: "42 oz" });
  });

  it("rounds up — you can't buy 0.63 of a bag", () => {
    expect(purchaseLabel(1.25, "cups", { purchaseUnitName: "8-oz bag", purchaseUnitQty: 2 }))
      .toEqual({ main: "1 × 8-oz bag", detail: "1.25 cups" });
  });

  it("does not over-buy on float dust", () => {
    expect(purchaseLabel(16.0000001, "oz", { purchaseUnitName: "1-lb pack", purchaseUnitQty: 16 }))
      .toEqual({ main: "1 × 1-lb pack", detail: "16 oz" });
  });

  it("returns null when the ingredient has no purchase unit configured", () => {
    expect(purchaseLabel(42, "oz", {})).toBeNull();
    expect(purchaseLabel(42, "oz", { purchaseUnitName: "pack" })).toBeNull();
    expect(purchaseLabel(42, "oz", { purchaseUnitName: "pack", purchaseUnitQty: 0 })).toBeNull();
  });

  it("returns null when there is nothing to buy", () => {
    expect(purchaseLabel(0, "oz", { purchaseUnitName: "pack", purchaseUnitQty: 16 })).toBeNull();
  });

  it("formats the detail through the shared quantity formatter", () => {
    expect(purchaseLabel(1.0577904, "tsp", { purchaseUnitName: "bottle", purchaseUnitQty: 96 }))
      .toEqual({ main: "1 × bottle", detail: "1.06 tsp" });
  });
});
