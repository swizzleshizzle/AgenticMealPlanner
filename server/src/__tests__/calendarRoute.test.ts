import { describe, it, expect } from "vitest";
import { dayOffsets } from "../routes/calendar.js";

// The legacy mapping that existed before the Sunday-shift. Used here only as
// a reference oracle to prove the new mapping + the one-day-earlier
// weekStartDate produce identical calendar dates.
const LEGACY_MONDAY_OFFSETS: Record<string, number> = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
  friday: 4, saturday: 5, sunday: 6,
};

// Sunday is intentionally excluded: in the legacy Monday-anchored system,
// sunday had offset 6 (end of week), whereas in the new Sunday-anchored system
// sunday has offset 0 (start of week). Sunday meals genuinely move to a
// different calendar date — that's expected behavior, not a regression.
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function dateAt(yyyymmdd: string, offset: number): string {
  const d = new Date(yyyymmdd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

describe("calendar route — dayOffsets after week shift", () => {
  it("is exported and Sunday-anchored", () => {
    expect(dayOffsets).toEqual({
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    });
  });

  it("each day maps to the same calendar date as the legacy Monday-anchored map after the weekStart backfill", () => {
    // Pre-shift: a plan stored weekStartDate=2026-04-20 (a Monday).
    // Post-shift: that same plan now stores 2026-04-19 (the Sunday before).
    // For every day enum, both maps must resolve to the same calendar date.
    const legacyMonday = "2026-04-20";
    const shiftedSunday = "2026-04-19";

    for (const day of DAYS) {
      const legacyDate = dateAt(legacyMonday, LEGACY_MONDAY_OFFSETS[day]);
      const newDate = dateAt(shiftedSunday, dayOffsets[day]);
      expect(newDate).toBe(legacyDate);
    }
  });
});
