import { describe, it, expect } from "vitest";
import {
  pickNextDefaultAfterArchive,
  resolvePlannedMealForShopping,
  type FamilyMember,
  type PlannedMealRef,
} from "../services/mealVersioning.js";

const m = (id: number, isDefault: boolean, archivedAt: Date | null, updatedAt: number): FamilyMember => ({
  id, isDefault, archivedAt, updatedAt: new Date(updatedAt),
});

describe("pickNextDefaultAfterArchive", () => {
  it("returns null when no other active members exist", () => {
    const fam = [m(1, true, null, 100)];
    expect(pickNextDefaultAfterArchive(fam, 1)).toBeNull();
  });

  it("returns null when the archived row was not the default", () => {
    const fam = [m(1, true, null, 100), m(2, false, null, 200)];
    expect(pickNextDefaultAfterArchive(fam, 2)).toBeNull();
  });

  it("picks the most-recently-updated active sibling when archiving the default", () => {
    const fam = [
      m(1, true,  null, 100),
      m(2, false, null, 300),
      m(3, false, null, 200),
    ];
    expect(pickNextDefaultAfterArchive(fam, 1)?.id).toBe(2);
  });

  it("ignores archived siblings when promoting", () => {
    const fam = [
      m(1, true,  null,            100),
      m(2, false, new Date(999),   500),
      m(3, false, null,            200),
    ];
    expect(pickNextDefaultAfterArchive(fam, 1)?.id).toBe(3);
  });
});

describe("resolvePlannedMealForShopping", () => {
  const recipeId = 7;
  const oldVersion = { id: 10, recipeId, isDefault: false, archivedAt: new Date(1) };
  const newVersion = { id: 11, recipeId, isDefault: true,  archivedAt: null };

  it("returns the row pointed at directly when status is cooked", () => {
    const ref: PlannedMealRef = { mealId: 10, status: "cooked" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, newVersion])?.id).toBe(10);
  });

  it("returns the row pointed at directly when status is skipped", () => {
    const ref: PlannedMealRef = { mealId: 10, status: "skipped" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, newVersion])?.id).toBe(10);
  });

  it("returns the row pointed at directly when status is swapped", () => {
    const ref: PlannedMealRef = { mealId: 10, status: "swapped" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, newVersion])?.id).toBe(10);
  });

  it("resolves to the family's current default when status is planned", () => {
    const ref: PlannedMealRef = { mealId: 10, status: "planned" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, newVersion])?.id).toBe(11);
  });

  it("falls back to the row pointed at when family has no active default", () => {
    const fullyArchived = { id: 11, recipeId, isDefault: false, archivedAt: new Date(2) };
    const ref: PlannedMealRef = { mealId: 10, status: "planned" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, fullyArchived])?.id).toBe(10);
  });

  it("returns null when the referenced row is unknown", () => {
    const ref: PlannedMealRef = { mealId: 99, status: "planned" };
    expect(resolvePlannedMealForShopping(ref, [oldVersion, newVersion])).toBeNull();
  });
});
