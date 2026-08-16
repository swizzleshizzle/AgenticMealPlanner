import { describe, it, expect } from "vitest";
import { isDescriptorUnit } from "./descriptorUnits";

describe("isDescriptorUnit", () => {
  it.each(["to taste", "To Taste", "as needed", "AS NEEDED", "pinch", "drizzle", "spray"])(
    "classifies %s as a descriptor",
    (u) => expect(isDescriptorUnit(u)).toBe(true),
  );

  it.each(["oz", "tsp", "count", "package", "whole"])(
    "does not classify real unit %s as a descriptor",
    (u) => expect(isDescriptorUnit(u)).toBe(false),
  );
});
