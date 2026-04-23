import { callClaude } from "./cli.js";
import { filterValidPlannedMeals, type MealCapability } from "./mealPlannerRules.js";

interface MealSummary {
  id: number;
  name: string;
  canBatch: boolean;
  canFresh: boolean;
  tags: string[];
  servings: number;
  calories: number | null;
}

interface PantryOverview {
  name: string;
  quantity: number;
  unit: string;
}

interface SuggestedPlan {
  meals: {
    mealId: number;
    day: string;
    mealSlot: string;
    servings: number;
    isPrep: boolean;
  }[];
}

export async function generateWeeklyPlan(
  meals: MealSummary[],
  pantry: PantryOverview[],
  recentMealIds: number[],
): Promise<SuggestedPlan> {
  const prompt = `You are a meal planning assistant. Generate a weekly meal plan (Monday-Sunday) for 2 people.

Rules:
- Sunday is the ONLY day that may contain batch-prep planned meals. Pick 2-3 meals with canBatch=true for Sunday (lunch and dinner slots), with isPrep=true.
- Every other day (Monday-Saturday) must have isPrep=false and the meal must have canFresh=true.
- Avoid meals used recently: ${JSON.stringify(recentMealIds)}
- Prefer meals that use ingredients already in the pantry.
- Balance nutrition and variety across the week.
- Each day should have lunch and dinner planned.

Available meals (each with capability flags):
${JSON.stringify(meals, null, 2)}

Current pantry:
${JSON.stringify(pantry, null, 2)}

Return ONLY valid JSON:
{
  "meals": [
    {
      "mealId": number,
      "day": "monday|tuesday|wednesday|thursday|friday|saturday|sunday",
      "mealSlot": "lunch|dinner",
      "servings": number,
      "isPrep": boolean
    }
  ]
}`;

  const raw = await callClaude(prompt, { timeout: 180_000 });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from Claude response");
  }

  const suggested: SuggestedPlan = JSON.parse(jsonMatch[0]);

  // Enforce the Sunday-only batch rule even if Claude slips.
  const capabilityMap: Record<number, MealCapability> = {};
  for (const m of meals) {
    capabilityMap[m.id] = { id: m.id, canBatch: m.canBatch, canFresh: m.canFresh };
  }
  return { meals: filterValidPlannedMeals(suggested.meals, capabilityMap) };
}
