import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import type { ToolDef } from "../types.js";
import { updatePlannedMeal } from "../../services/plannerService.js";

const prisma = new PrismaClient();

function dbDateYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const getPlannedWeek: ToolDef = {
  name: "get_planned_week",
  description:
    "Fetch the weekly plan for a Monday-anchored week. If weekStartDate is not given, falls back to the page context's loaded week. Returns null if no plan exists.",
  schema: z.object({
    weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  handler: async (input, ctx) => {
    const week = input.weekStartDate ?? ctx.pageContext.weekStartDate;
    if (!week) {
      return { plan: null, error: "No week specified and no week in page context" };
    }
    const plan = await prisma.weeklyPlan.findFirst({
      where: { weekStartDate: new Date(week) },
      include: { plannedMeals: { include: { meal: true } } },
    });
    if (!plan) return { plan: null };
    return {
      plan: {
        id: plan.id,
        weekStartDate: dbDateYmd(plan.weekStartDate),
        status: plan.status,
        meals: plan.plannedMeals.map((pm) => ({
          id: pm.id,
          mealId: pm.mealId,
          mealName: pm.meal.name,
          day: pm.day,
          mealSlot: pm.mealSlot,
          servings: pm.servings,
          status: pm.status,
          cookStyle: pm.cookStyle ?? null,
        })),
      },
    };
  },
};

const swapMeal: ToolDef = {
  name: "swap_meal",
  description: "Replace the recipe on a planned-meal slot with a different recipe.",
  schema: z.object({
    plannedMealId: z.number().int(),
    newMealId: z.number().int(),
  }),
  handler: async (input) => {
    const plannedMeal = await updatePlannedMeal(input.plannedMealId, { mealId: input.newMealId });
    return { plannedMeal };
  },
};

const skipMeal: ToolDef = {
  name: "skip_meal",
  description: "Mark a planned meal as skipped (won't be cooked, won't deduct pantry).",
  schema: z.object({ plannedMealId: z.number().int() }),
  handler: async (input) => {
    const plannedMeal = await updatePlannedMeal(input.plannedMealId, { status: "skipped" });
    return { plannedMeal };
  },
};

const scaleServings: ToolDef = {
  name: "scale_servings",
  description: "Change the number of servings on a planned meal (affects pantry deduction).",
  schema: z.object({
    plannedMealId: z.number().int(),
    newServings: z.number().positive(),
  }),
  handler: async (input) => {
    const plannedMeal = await updatePlannedMeal(input.plannedMealId, { servings: input.newServings });
    return { plannedMeal };
  },
};

export const planTools: ToolDef[] = [getPlannedWeek, swapMeal, skipMeal, scaleServings];
