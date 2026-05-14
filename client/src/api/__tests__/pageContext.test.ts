import { describe, it, expect } from "vitest";
import { derivePageContext } from "../pageContext";

describe("derivePageContext", () => {
  it("returns { path } for an unmatched route", () => {
    expect(derivePageContext({ pathname: "/chat" } as any)).toEqual({ path: "/chat" });
  });

  it("extracts planId from /plans/:id", () => {
    expect(derivePageContext({ pathname: "/plans/42" } as any)).toEqual({
      path: "/plans/42",
      planId: 42,
    });
  });

  it("extracts mealId from /meals/:id", () => {
    expect(derivePageContext({ pathname: "/meals/7" } as any)).toEqual({
      path: "/meals/7",
      mealId: 7,
    });
  });

  it("ignores non-numeric segments", () => {
    expect(derivePageContext({ pathname: "/plans/new" } as any)).toEqual({
      path: "/plans/new",
    });
  });

  it("handles trailing slashes", () => {
    expect(derivePageContext({ pathname: "/plans/42/" } as any)).toEqual({
      path: "/plans/42/",
      planId: 42,
    });
  });

  it("extracts mealId from /recipes/:id", () => {
    expect(derivePageContext({ pathname: "/recipes/12" } as any)).toEqual({
      path: "/recipes/12",
      mealId: 12,
    });
  });

  it("extracts mealId from /recipes/:id/edit", () => {
    expect(derivePageContext({ pathname: "/recipes/12/edit" } as any)).toEqual({
      path: "/recipes/12/edit",
      mealId: 12,
    });
  });

  it("does not match /recipes/new", () => {
    expect(derivePageContext({ pathname: "/recipes/new" } as any)).toEqual({
      path: "/recipes/new",
    });
  });
});
