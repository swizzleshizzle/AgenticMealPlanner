import { describe, it, expect } from "vitest";
import { coverageLabel } from "./coverageLabel";

describe("coverageLabel", () => {
  it("states need and on-hand honestly instead of printing need as 'Have'", () => {
    // The old label rendered "Have 72 oz" for an item needing 72 with 97.62 on hand.
    expect(coverageLabel(72, 97.6197328, "oz")).toBe("Need 72 · have 97.6 oz");
  });

  it("formats both quantities through the shared formatter", () => {
    expect(coverageLabel(1.057790416126034, 2, "tsp")).toBe("Need 1.06 · have 2 tsp");
  });

  it("omits a missing unit without leaving a dangling space", () => {
    expect(coverageLabel(2, 3, "")).toBe("Need 2 · have 3");
  });
});
