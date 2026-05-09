import { describe, it, expect } from "vitest";
import { weeklyWindow } from "../services/receiptService.js";

describe("weeklyWindow", () => {
  it("returns Sunday → Saturday for a midweek date", () => {
    // 2026-05-06 is a Wednesday
    const { weekStart, weekEnd } = weeklyWindow(new Date("2026-05-06T12:00:00"));
    expect(weekStart.toISOString().slice(0, 10)).toBe("2026-05-03"); // Sunday
    expect(weekEnd.toISOString().slice(0, 10)).toBe("2026-05-09");   // Saturday
  });

  it("returns same Sunday for a Sunday input", () => {
    const { weekStart } = weeklyWindow(new Date("2026-05-03T12:00:00"));
    expect(weekStart.toISOString().slice(0, 10)).toBe("2026-05-03");
  });

  it("returns Saturday's week (not next week's) for a Saturday input", () => {
    const { weekStart, weekEnd } = weeklyWindow(new Date("2026-05-09T23:00:00"));
    expect(weekStart.toISOString().slice(0, 10)).toBe("2026-05-03");
    expect(weekEnd.toISOString().slice(0, 10)).toBe("2026-05-09");
  });
});
