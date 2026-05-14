import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../agent/prompt.js";

describe("buildSystemPrompt", () => {
  it("substitutes today and currentWeekStart", () => {
    const out = buildSystemPrompt({
      today: "2026-05-12",
      currentWeekStart: "2026-05-11",
      pageContext: {},
    });
    expect(out).toContain("Today: 2026-05-12");
    expect(out).toContain("Current week starts: 2026-05-11");
  });

  it("renders an empty page context as 'No specific page context.'", () => {
    const out = buildSystemPrompt({
      today: "2026-05-12",
      currentWeekStart: "2026-05-11",
      pageContext: {},
    });
    expect(out).toContain("No specific page context.");
  });

  it("renders a page context with path and ids", () => {
    const out = buildSystemPrompt({
      today: "2026-05-12",
      currentWeekStart: "2026-05-11",
      pageContext: { path: "/recipes/42", mealId: 42 },
    });
    expect(out).toContain("path: /recipes/42");
    expect(out).toContain("mealId: 42");
  });

  it("includes the loaded plan's week if pageContext.weekStartDate is set", () => {
    const out = buildSystemPrompt({
      today: "2026-05-12",
      currentWeekStart: "2026-05-11",
      pageContext: { path: "/planner", weekStartDate: "2026-05-18" },
    });
    expect(out).toContain("weekStartDate: 2026-05-18");
  });
});
