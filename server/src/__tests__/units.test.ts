import { describe, it, expect } from "vitest";
import { convert, UnitConversionError, isDescriptorUnit, type DensityHint } from "../lib/units.js";

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
  it.each(["whole", "packet", "package", "pack", "clove", "cloves", "slice", "head", "can", "ear", "bag", "block", "thumb"])(
    "%s converts to count 1:1",
    (u) => {
      expect(convert(2, u, "count")).toBe(2);
    },
  );

  it("count-family units interconvert (whole -> unit)", () => {
    expect(convert(3, "whole", "unit")).toBe(3);
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
