export interface FamilyMember {
  id: number;
  isDefault: boolean;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface VersionRow {
  id: number;
  recipeId: number;
  isDefault: boolean;
  archivedAt: Date | null;
}

export interface PlannedMealRef {
  mealId: number;
  status: "planned" | "cooked" | "skipped" | "swapped";
}

// When archiving a row that is currently the family's default, pick the
// next-most-recently-updated active sibling to promote. Returns null if
// the archived row was not the default, or no other active members exist.
export function pickNextDefaultAfterArchive(
  family: FamilyMember[],
  archivingId: number,
): FamilyMember | null {
  const archiving = family.find((m) => m.id === archivingId);
  if (!archiving || !archiving.isDefault) return null;

  const candidates = family
    .filter((m) => m.id !== archivingId && m.archivedAt === null)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return candidates[0] ?? null;
}

// Resolve which version row a PlannedMeal points at for shopping aggregation.
// Status `cooked` / `skipped` / `swapped` freeze to the referenced row;
// `planned` floats to the family's current active default. Falls back to
// the referenced row if no active default exists (entire family archived).
export function resolvePlannedMealForShopping(
  ref: PlannedMealRef,
  allRows: VersionRow[],
): VersionRow | null {
  const referenced = allRows.find((r) => r.id === ref.mealId);
  if (!referenced) return null;

  if (ref.status !== "planned") return referenced;

  const currentDefault = allRows.find(
    (r) => r.recipeId === referenced.recipeId && r.isDefault && r.archivedAt === null,
  );
  return currentDefault ?? referenced;
}
