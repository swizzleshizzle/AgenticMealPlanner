import { describe, it, expect } from "vitest";
import { suggestExpirationDate } from "../services/pantryBatchService.js";

describe("suggestExpirationDate", () => {
  const tripDate = new Date("2026-05-01T00:00:00Z");

  it("uses fridge shelf-life when location is fridge", () => {
    expect(
      suggestExpirationDate({
        tripDate,
        location: "fridge",
        ingredient: { shelfLifeFridgeDays: 7, shelfLifeFreezerDays: 30, shelfLifePantryDays: null },
      }),
    ).toEqual(new Date("2026-05-08T00:00:00Z"));
  });

  it("uses freezer shelf-life when location is freezer", () => {
    expect(
      suggestExpirationDate({
        tripDate,
        location: "freezer",
        ingredient: { shelfLifeFridgeDays: 7, shelfLifeFreezerDays: 30, shelfLifePantryDays: null },
      }),
    ).toEqual(new Date("2026-05-31T00:00:00Z"));
  });

  it("returns null when shelf-life for the location is missing", () => {
    expect(
      suggestExpirationDate({
        tripDate,
        location: "pantry",
        ingredient: { shelfLifeFridgeDays: 7, shelfLifeFreezerDays: 30, shelfLifePantryDays: null },
      }),
    ).toBeNull();
  });
});
