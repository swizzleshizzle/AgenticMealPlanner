import type { ZodSchema } from "zod";

export interface PageContext {
  path?: string;                 // e.g. "/planner", "/recipes/42"
  planId?: number;               // active plan in view, if any
  weekStartDate?: string;        // YYYY-MM-DD if a specific week is loaded
  mealId?: number;               // recipe detail / edit page
  plannedMealId?: number;        // cook modal context
}

export interface ToolDef<TInput = any, TOutput = any> {
  name: string;
  description: string;
  schema: ZodSchema<TInput>;
  handler: (input: TInput, ctx: { pageContext: PageContext }) => Promise<TOutput>;
}

export interface AgentResult {
  message: string;
  toolCalls: { name: string; input: unknown; output: unknown; isError: boolean }[];
}

export type StreamEvent =
  | { type: "tool_call_start"; name: string }
  | { type: "tool_call_end"; name: string; isError: boolean }
  | { type: "text_delta"; delta: string }
  | { type: "done"; message: string; toolCalls: AgentResult["toolCalls"] }
  | { type: "error"; error: string };
