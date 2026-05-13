import { z } from "zod";
import { generateShoppingList } from "../../services/shoppingService.js";
import type { ToolDef } from "../types.js";

const getShoppingList: ToolDef = {
  name: "get_shopping_list",
  description:
    "Get the shopping list for a weekly plan (aggregated unmet ingredients). Falls back to the page context's planId.",
  schema: z.object({ planId: z.number().int().optional() }),
  handler: async (input, ctx) => {
    const planId = input.planId ?? ctx.pageContext.planId;
    if (!planId) return { items: [], error: "No planId provided and none in page context" };
    const items = await generateShoppingList(planId);
    return { items };
  },
};

export const shoppingTools: ToolDef[] = [getShoppingList];
