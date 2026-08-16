import { describe, it, expect } from "vitest";
import { formatQuantity, roundQuantity } from "./formatQuantity";

describe("formatQuantity", () => {
  it("caps float dust at two decimals", () => {
    expect(formatQuantity(1.057790416126034)).toBe("1.06");
    expect(formatQuantity(0.5567540211636364)).toBe("0.56");
    expect(formatQuantity(0.5499999999999996)).toBe("0.55");
  });

  it("drops trailing zeros and needless decimals", () => {
    expect(formatQuantity(2)).toBe("2");
    expect(formatQuantity(2.5)).toBe("2.5");
    expect(formatQuantity(2.5)).not.toBe("2.50");
    expect(formatQuantity(1.999999999)).toBe("2");
  });

  it("rounds large quantities to whole numbers", () => {
    expect(formatQuantity(97.6197328)).toBe("97.6");
    expect(formatQuantity(102.4)).toBe("102");
  });

  it("never renders a positive amount as zero", () => {
    expect(formatQuantity(0.004)).toBe("<0.01");
    expect(formatQuantity(0)).toBe("0");
  });
});

describe("roundQuantity", () => {
  it("rounds editable prefill values to two decimals so inputs match what commits", () => {
    expect(roundQuantity(0.24250000000000002)).toBe(0.24);
    expect(roundQuantity(0.36511234)).toBe(0.37);
    expect(roundQuantity(12)).toBe(12);
  });
});
