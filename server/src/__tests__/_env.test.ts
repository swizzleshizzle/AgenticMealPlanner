import { describe, it, expect } from "vitest";

describe("test environment", () => {
  it("DATABASE_URL points at mealplanner_test, not mealplanner", () => {
    const url = process.env.DATABASE_URL ?? "";
    expect(url).toMatch(/mealplanner_test/);
    expect(url).not.toMatch(/\/mealplanner(\?|$)/);
  });
});
