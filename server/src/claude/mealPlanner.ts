import { callClaude } from "./cli.js";

interface MealSummary {
  id: number;
  name: string;
  mealType: string;
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
- Pick 2-3 batch_prep meals for Sunday prep that cover lunches/dinners through the week
- Pick 2-3 cook_fresh meals for dinners that are cooked that evening
- Avoid meals used recently: ${JSON.stringify(recentMealIds)}
- Prefer meals that use ingredients already in the pantry
- Balance nutrition and variety across the week
- Each day should have lunch and dinner planned

Available meals:
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

  return JSON.parse(jsonMatch[0]);
}
