import { describe, it, expect } from "vitest";
import { convert, UnitConversionError, isDescriptorUnit, unitsPerContainerFor, type DensityHint } from "../lib/units.js";

describe("convert", () => {
  it("same-unit returns the same value", () => {
    expect(convert(2, "lb", "lb")).toBe(2);
  });

  it("mass: lb -> oz", () => {
    expect(convert(1, "lb", "oz")).toBeCloseTo(16, 5);
  });

  it("mass: oz -> g", () => {
    expect(convert(1, "oz", "g")).toBeCloseTo(28.3495, 3);
  });

  it("volume: cup -> tbsp", () => {
    expect(convert(1, "cup", "tbsp")).toBeCloseTo(16, 3);
  });

  it("volume: tbsp -> tsp", () => {
    expect(convert(1, "tbsp", "tsp")).toBeCloseTo(3, 3);
  });

  it("volume: cup -> mL", () => {
    expect(convert(1, "cup", "mL")).toBeCloseTo(236.588, 2);
  });

  it("count -> count", () => {
    expect(convert(3, "count", "count")).toBe(3);
  });

  it("normalizes unit aliases (LB, lbs, fl oz)", () => {
    expect(convert(1, "LB", "oz")).toBeCloseTo(16, 5);
    expect(convert(1, "lbs", "oz")).toBeCloseTo(16, 5);
    expect(convert(8, "fl oz", "cup")).toBeCloseTo(1.0, 3);
  });

  it("cross-type mass<->volume requires density", () => {
    const hint: DensityHint = { densityGPerMl: 0.529 }; // ~flour
    expect(convert(1, "cup", "g", hint)).toBeCloseTo(125.16, 1);
  });

  it("cross-type count<->mass requires gramsPerCount", () => {
    const hint: DensityHint = { gramsPerCount: 50 }; // egg
    expect(convert(3, "count", "g", hint)).toBeCloseTo(150, 5);
  });

  it("cross-type without density throws UnitConversionError", () => {
    expect(() => convert(1, "cup", "g")).toThrow(UnitConversionError);
  });

  it("UnitConversionError carries which field is missing", () => {
    try {
      convert(1, "cup", "g");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UnitConversionError);
      expect((e as UnitConversionError).missing).toBe("densityGPerMl");
      expect((e as UnitConversionError).fromUnit).toBe("cup");
      expect((e as UnitConversionError).toUnit).toBe("g");
    }
  });

  it("unknown unit throws UnitConversionError", () => {
    expect(() => convert(1, "blarg", "g")).toThrow(UnitConversionError);
  });
});

describe("discrete count units", () => {
  it.each(["whole", "clove", "cloves", "slice", "head", "ear", "thumb"])(
    "each-like unit %s converts to count 1:1",
    (u) => {
      expect(convert(2, u, "count")).toBe(2);
    },
  );

  it("count-family units interconvert (whole -> unit)", () => {
    expect(convert(3, "whole", "unit")).toBe(3);
  });

  // A container is not an item: 1 package of buns ≠ 1 bun. Pretending they
  // convert 1:1 is how a cook double-charged the pantry (drained a 0.25
  // "package" batch as 0.25 buns, then kept going into the count batch).
  it.each(["packet", "package", "pack", "can", "bag", "block"])(
    "container unit %s refuses conversion to count",
    (u) => {
      expect(() => convert(2, u, "count")).toThrow(UnitConversionError);
      expect(() => convert(2, "count", u)).toThrow(UnitConversionError);
    },
  );

  it("container units interconvert 1:1 (both mean one retail container)", () => {
    expect(convert(2, "pack", "package")).toBe(2);
    expect(convert(1, "can", "bag")).toBe(1);
  });

  it("container units refuse the gramsPerCount bridge (it describes one item, not one container)", () => {
    expect(() => convert(1, "package", "oz", { gramsPerCount: 80 })).toThrow(UnitConversionError);
  });

  it("each-like units still bridge to mass via gramsPerCount", () => {
    expect(convert(2, "count", "oz", { gramsPerCount: 28.3495 })).toBeCloseTo(2, 5);
  });

  // With a known package size (unitsPerContainer, sourced from the
  // ingredient's purchaseUnitQty when its default unit is count-type), the
  // container ↔ each-like refusal lifts and the math is real.
  it("converts container to count when the package size is known", () => {
    expect(convert(0.25, "package", "count", { unitsPerContainer: 8 })).toBeCloseTo(2, 5);
    expect(convert(2, "count", "package", { unitsPerContainer: 8 })).toBeCloseTo(0.25, 5);
  });

  it("bridges container to mass through the package size and gramsPerCount", () => {
    // 1 package = 8 buns, 1 bun ≈ 1 oz → 1 package ≈ 8 oz.
    expect(convert(1, "package", "oz", { unitsPerContainer: 8, gramsPerCount: 28.3495 })).toBeCloseTo(8, 4);
  });

  it("still refuses container conversion when the package size is unknown", () => {
    expect(() => convert(0.25, "package", "count", {})).toThrow(UnitConversionError);
    expect(() => convert(1, "package", "oz", { gramsPerCount: 28.3495 })).toThrow(UnitConversionError);
  });
});

describe("isDescriptorUnit", () => {
  it.each(["to taste", "To Taste", "pinch", "drizzle", "spray", "as needed", "AS NEEDED"])(
    "classifies %s as a descriptor",
    (u) => {
      expect(isDescriptorUnit(u)).toBe(true);
    },
  );

  it.each(["oz", "tbsp", "whole", "count", "packet", "cup"])(
    "does not classify real unit %s as a descriptor",
    (u) => {
      expect(isDescriptorUnit(u)).toBe(false);
    },
  );
});

describe("unitsPerContainerFor", () => {
  it("uses purchaseUnitQty when the default unit is an each-like count", () => {
    expect(unitsPerContainerFor({ defaultUnit: "count", purchaseUnitQty: 8 })).toBe(8);
    expect(unitsPerContainerFor({ defaultUnit: "whole", purchaseUnitQty: 6 })).toBe(6);
  });

  it("returns null for mass/volume default units (qty means something else there)", () => {
    expect(unitsPerContainerFor({ defaultUnit: "oz", purchaseUnitQty: 16 })).toBeNull();
    expect(unitsPerContainerFor({ defaultUnit: "cup", purchaseUnitQty: 2 })).toBeNull();
  });

  it("returns null for container default units, unset or non-positive qty, unknown units", () => {
    expect(unitsPerContainerFor({ defaultUnit: "package", purchaseUnitQty: 8 })).toBeNull();
    expect(unitsPerContainerFor({ defaultUnit: "count", purchaseUnitQty: null })).toBeNull();
    expect(unitsPerContainerFor({ defaultUnit: "count", purchaseUnitQty: 0 })).toBeNull();
    expect(unitsPerContainerFor({ defaultUnit: "gibberish", purchaseUnitQty: 8 })).toBeNull();
  });
});
