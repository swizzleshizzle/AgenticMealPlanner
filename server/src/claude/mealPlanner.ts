import { callClaudeViaSdk } from "./sdkClient.js";
import { filterValidPlannedMeals, type MealCapability } from "./mealPlannerRules.js";
import { prisma } from "../lib/prisma.js";
import { addPlannedMeal, getPlanById } from "../services/plannerService.js";

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
    cookStyle: "cook_fresh" | "batch_prep" | "leftovers";
  }[];
}

async function _generateMealSuggestions(
  meals: MealSummary[],
  pantry: PantryOverview[],
  recentMealIds: number[],
): Promise<SuggestedPlan> {
  const prompt = `You are a meal planning assistant. Generate a weekly meal plan (Sunday → Saturday) for 2 people.

Cook styles per slot:
- "cook_fresh" — cooked the same day. Meal must have canFresh=true.
- "batch_prep" — cooked Sunday only, in larger quantity. Meal must have canBatch=true. Set servings to 4 or more.
- "leftovers" — eat from a previous batch_prep. No recipe-capability requirement; reuses the same mealId as the source batch_prep.

Rules:
- Sunday is the prep day (day 1 of the plan). Sunday has two slots (lunch + dinner). Pick 1–2 batch_prep meals for Sunday with servings >= 4.
- For each Sunday batch_prep meal you MAY fill 1–2 downstream slots (Mon–Wed) with cookStyle="leftovers" referencing the same mealId, servings=2. This reduces the shopping list and reuses the prep.
- Every other slot is cookStyle="cook_fresh" and the meal must have canFresh=true.
- batch_prep on any day other than Sunday is invalid; do not emit it.
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
      "day": "sunday|monday|tuesday|wednesday|thursday|friday|saturday",
      "mealSlot": "lunch|dinner",
      "servings": number,
      "cookStyle": "cook_fresh" | "batch_prep" | "leftovers"
    }
  ]
}`;

  const raw = await callClaudeViaSdk({ userPrompt: prompt, timeoutMs: 180_000 });
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

/**
 * Generate a full week of AI-suggested meals for an existing WeeklyPlan.
 * Fetches available meals, pantry state, and recent meal history, calls the
 * AI planner, inserts all suggested PlannedMeal rows, and returns the
 * updated WeeklyPlan (with plannedMeals included).
 */
export async function generateWeeklyPlan(planId: number) {
  const allMeals = await prisma.meal.findMany({
    where: { isDefault: true, archivedAt: null },
    select: { id: true, name: true, canBatch: true, canFresh: true, tags: true, servings: true, calories: true },
  });

  const pantryItems = await prisma.pantryBatch.findMany({
    where: { consumedAt: null },
    include: { ingredient: true },
  });
  const pantry = pantryItems.map((p) => ({
    name: p.ingredient.name,
    quantity: p.quantity,
    unit: p.unit,
  }));

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const recentPlans = await prisma.plannedMeal.findMany({
    where: { plan: { weekStartDate: { gte: twoWeeksAgo } } },
    select: { mealId: true },
  });
  const recentMealIds = [...new Set(recentPlans.map((p) => p.mealId))];

  const suggested = await _generateMealSuggestions(allMeals, pantry, recentMealIds);

  for (const meal of suggested.meals) {
    await addPlannedMeal(planId, {
      mealId: meal.mealId,
      day: meal.day,
      mealSlot: meal.mealSlot,
      servings: meal.servings,
      cookStyle: meal.cookStyle,
    });
  }

  const updatedPlan = await getPlanById(planId);
  return updatedPlan!;
}
