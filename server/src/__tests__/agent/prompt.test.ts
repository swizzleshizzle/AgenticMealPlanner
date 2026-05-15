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

  it("puts Today at the very top of the prompt", () => {
    const out = buildSystemPrompt({
      today: "2026-05-14",
      currentWeekStart: "2026-05-10",
      pageContext: {},
    });
    const trimmed = out.trimStart();
    expect(trimmed.startsWith("Today: 2026-05-14")).toBe(true);
  });

  it("includes the assertive 'Trust this date' instruction", () => {
    const out = buildSystemPrompt({
      today: "2026-05-14",
      currentWeekStart: "2026-05-10",
      pageContext: {},
    });
    expect(out).toContain("Trust this date");
    expect(out).toMatch(/Do NOT use your training knowledge/i);
  });

  it("declares weeks as Sunday-anchored and references Sunday resolution", () => {
    const out = buildSystemPrompt({
      today: "2026-05-14",
      currentWeekStart: "2026-05-10",
      pageContext: {},
    });
    expect(out).toContain("Sunday-anchored");
    expect(out).toMatch(/resolve it to a Sunday/i);
  });

  it("never mentions Monday-anchored or Monday resolution", () => {
    const out = buildSystemPrompt({
      today: "2026-05-14",
      currentWeekStart: "2026-05-10",
      pageContext: {},
    });
    expect(out).not.toMatch(/Monday-anchored/);
    expect(out).not.toMatch(/resolve it to a Monday/);
  });
});
