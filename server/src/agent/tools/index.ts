import { pantryTools } from "./pantry.js";
import { planTools } from "./plan.js";
import { recipeTools } from "./recipes.js";
import { shoppingTools } from "./shopping.js";
import { receiptTools } from "./receipts.js";
import type { ToolDef } from "../types.js";

export const allTools: ToolDef[] = [
  ...pantryTools,
  ...planTools,
  ...recipeTools,
  ...shoppingTools,
  ...receiptTools,
];
