export interface PlannedMealCandidate {
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  isPrep: boolean;
}

export interface MealCapability {
  id: number;
  canBatch: boolean;
  canFresh: boolean;
}

// Enforces the Sunday-only batch rule after Claude returns a suggested plan:
//  - isPrep=true is permitted only when day="sunday" and the meal canBatch.
//  - isPrep=false requires the meal canFresh.
//  - Unknown mealIds are dropped.
export function filterValidPlannedMeals(
  planned: PlannedMealCandidate[],
  mealsById: Record<number, MealCapability>,
): PlannedMealCandidate[] {
  return planned.filter((pm) => {
    const meal = mealsById[pm.mealId];
    if (!meal) return false;
    if (pm.isPrep) {
      return pm.day === "sunday" && meal.canBatch;
    }
    return meal.canFresh;
  });
}
