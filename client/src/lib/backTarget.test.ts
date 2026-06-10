// client/src/lib/backTarget.test.ts
import { describe, it, expect } from "vitest";
import { resolveBackTarget } from "./backTarget";

describe("resolveBackTarget", () => {
  it("returns the planner target when from is /planner", () => {
    expect(resolveBackTarget("/planner")).toEqual({ to: "/planner", label: "Back to planner" });
  });

  it("returns the dashboard target when from is /", () => {
    expect(resolveBackTarget("/")).toEqual({ to: "/", label: "Back to dashboard" });
  });

  it("returns the recipes target when from is /recipes", () => {
    expect(resolveBackTarget("/recipes")).toEqual({ to: "/recipes", label: "Back to recipes" });
  });

  it("falls back to recipes when from is undefined (cold load / reload)", () => {
    expect(resolveBackTarget(undefined)).toEqual({ to: "/recipes", label: "Back to recipes" });
  });

  it("falls back to recipes for an unknown origin", () => {
    expect(resolveBackTarget("/pantry")).toEqual({ to: "/recipes", label: "Back to recipes" });
  });

  it("ignores non-string values", () => {
    expect(resolveBackTarget({ nope: true })).toEqual({ to: "/recipes", label: "Back to recipes" });
  });
});
