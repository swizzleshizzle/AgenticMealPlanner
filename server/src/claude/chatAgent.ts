import { callClaude } from "./cli.js";

interface ChatContext {
  meals: { id: number; name: string; tags: string[]; canBatch: boolean; canFresh: boolean }[];
  pantry: { name: string; quantity: number; unit: string }[];
  currentPlan: {
    id: number;
    meals: { id: number; mealName: string; day: string; mealSlot: string; servings: number; status: string }[];
  } | null;
}

export interface ChatResponse {
  message: string;
  actions: {
    type: "swap_meal" | "skip_meal" | "scale_servings" | "add_meal" | "update_pantry" | "none";
    params: Record<string, any>;
  }[];
}

export async function chat(userMessage: string, context: ChatContext): Promise<ChatResponse> {
  const prompt = `You are a helpful meal planning assistant. The user manages their weekly meals through this app.

Current state:
- Recipe library: ${JSON.stringify(context.meals)}
- Pantry: ${JSON.stringify(context.pantry)}
- This week's plan: ${JSON.stringify(context.currentPlan)}

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
