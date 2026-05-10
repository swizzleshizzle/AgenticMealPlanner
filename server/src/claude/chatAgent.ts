import { callClaude } from "./cli.js";

interface ChatContext {
  meals: { id: number; name: string; tags: string[]; canBatch: boolean; canFresh: boolean }[];
  pantry: { name: string; quantity: number; unit: string }[];
  currentPlan: {
    id: number;
    weekStartDate: string;
    meals: { id: number; mealName: string; day: string; mealSlot: string; servings: number; status: string }[];
  } | null;
  today: string;
  currentWeekStart: string;
}

export interface ChatResponse {
  message: string;
  actions: {
    type: "swap_meal" | "skip_meal" | "scale_servings" | "add_meal" | "update_pantry" | "none";
    params: Record<string, any>;
  }[];
}

export async function chat(userMessage: string, context: ChatContext): Promise<ChatResponse> {
  const loadedWeek = context.currentPlan?.weekStartDate ?? null;
  const planLabel = loadedWeek
    ? loadedWeek === context.currentWeekStart
      ? `the current week (Monday ${loadedWeek})`
      : `the week of Monday ${loadedWeek}`
    : "no plan loaded";

  const prompt = `You are a helpful meal planning assistant. The user manages their weekly meals through this app.

Date context (Monday-anchored weeks):
- Today: ${context.today}
- Current week starts: ${context.currentWeekStart}
- Loaded plan covers: ${planLabel}

If the user references "this week", "next week", "last week", or a specific date,
resolve it to a Monday using the dates above. Then check whether it matches the
loaded plan's weekStartDate.
- If it matches, act on the loaded plan's meals.
- If it does NOT match, do NOT invent plannedMealIds for other weeks. Reply with
  type:"none" and a message explaining you only have data for the loaded week
  (${loadedWeek ?? "no plan loaded"}). Suggest the user navigate to that week in
  the planner first.

Current state:
- Recipe library: ${JSON.stringify(context.meals)}
- Pantry: ${JSON.stringify(context.pantry)}
- Loaded plan: ${JSON.stringify(context.currentPlan)}

User message: "${userMessage}"

Respond with ONLY valid JSON:
{
  "message": "Your friendly response to the user",
  "actions": [
    {
      "type": "swap_meal|skip_meal|scale_servings|add_meal|update_pantry|none",
      "params": { ... relevant params ... }
    }
  ]
}

Action param schemas:
- swap_meal: { "plannedMealId": number, "newMealId": number, "day": string, "mealSlot": string }
- skip_meal: { "plannedMealId": number }
- scale_servings: { "plannedMealId": number, "newServings": number }
- add_meal: { "mealId": number, "day": string, "mealSlot": string, "servings": number }
- update_pantry: { "ingredientName": string, "quantity": number, "unit": string, "action": "set|remove" }
- none: {} (just a conversational response)

Be concise and helpful.`;

  const raw = await callClaude(prompt, { timeout: 120_000 });
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from Claude response");
  }

  return JSON.parse(jsonMatch[0]);
}
