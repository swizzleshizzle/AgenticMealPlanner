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

// Validates a Claude-suggested plan against the cook-style rules:
//  - batch_prep is permitted only when day="sunday" and the meal canBatch.
//  - cook_fresh requires the meal canFresh.
//  - leftovers is accepted on any day with any meal capability.
//  - Unknown mealIds are dropped.
export function filterValidPlannedMeals(
  planned: PlannedMealCandidate[],
  mealsById: Record<number, MealCapability>,
): PlannedMealCandidate[] {
  return planned.filter((pm) => {
    const meal = mealsById[pm.mealId];
    if (!meal) return false;
    switch (pm.cookStyle) {
      case "batch_prep": return pm.day === "sunday" && meal.canBatch;
      case "leftovers":  return true;
      case "cook_fresh": return meal.canFresh;
    }
  });
}
