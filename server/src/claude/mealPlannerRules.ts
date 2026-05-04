export interface PlannedMealCandidate {
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
}

export interface MealCapability {
  id: number;
  canBatch: boolean;
  canFresh: boolean;
}

// Enforces the Sunday-only batch rule after Claude returns a suggested plan:
//  - cookStyle="batch_prep" is permitted only when day="sunday" and the meal canBatch.
//  - cookStyle="leftovers" is permitted any day.
//  - cookStyle="cook_fresh" requires the meal canFresh.
//  - Unknown mealIds are dropped.
export function filterValidPlannedMeals(
  planned: PlannedMealCandidate[],
  mealsById: Record<number, MealCapability>,
): PlannedMealCandidate[] {
  return planned.filter((pm) => {
    const meal = mealsById[pm.mealId];
    if (!meal) return false;
    if (pm.cookStyle === "batch_prep") {
      return pm.day === "sunday" && meal.canBatch;
    }
    if (pm.cookStyle === "leftovers") {
      return true;
    }
    return meal.canFresh;
  });
}
