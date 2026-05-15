import { describe, it, expect } from "vitest";
import { thisWeekSunday } from "../../agent/runner.js";

describe("thisWeekSunday", () => {
  it("returns the same day for a Sunday input", () => {
    expect(thisWeekSunday(new Date(2026, 4, 10, 14, 0, 0))).toBe("2026-05-10");
  });
  it("rolls back to Sunday for Monday", () => {
    expect(thisWeekSunday(new Date(2026, 4, 11, 14, 0, 0))).toBe("2026-05-10");
  });
  it("rolls back to Sunday for Tuesday", () => {
    expect(thisWeekSunday(new Date(2026, 4, 12, 14, 0, 0))).toBe("2026-05-10");
  });
  it("rolls back to Sunday for Wednesday", () => {
    expect(thisWeekSunday(new Date(2026, 4, 13, 14, 0, 0))).toBe("2026-05-10");
  });
  it("rolls back to Sunday for Thursday", () => {
    expect(thisWeekSunday(new Date(2026, 4, 14, 14, 0, 0))).toBe("2026-05-10");
  });
  it("rolls back to Sunday for Friday", () => {
    expect(thisWeekSunday(new Date(2026, 4, 15, 14, 0, 0))).toBe("2026-05-10");
  });
  it("rolls back to Sunday for Saturday", () => {
    expect(thisWeekSunday(new Date(2026, 4, 16, 14, 0, 0))).toBe("2026-05-10");
  });
  it("crosses a month boundary correctly", () => {
    expect(thisWeekSunday(new Date(2026, 5, 1, 14, 0, 0))).toBe("2026-05-31");
  });
});
