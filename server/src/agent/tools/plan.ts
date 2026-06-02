import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import type { ToolDef } from "../types.js";
import { updatePlannedMeal } from "../../services/plannerService.js";
import { deductIngredientsForMeal } from "../../services/pantryService.js";

const prisma = new PrismaClient();

function dbDateYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const getPlannedWeek: ToolDef = {
  name: "get_planned_week",
  description:
    "Fetch the weekly plan for a Sunday-anchored week. weekStartDate must be a Sunday in YYYY-MM-DD. If weekStartDate is not given, falls back to the page context's loaded week. Returns null if no plan exists.",
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

const CookStyleEnum = z.enum(["cook_fresh", "batch_prep", "leftovers"]);

const addPlannedMeal: ToolDef = {
  name: "add_planned_meal",
  description:
    "Add a meal to the week's plan. Creates the WeeklyPlan if one doesn't exist for weekStartDate. day is lowercase weekday (monday..sunday). mealSlot is 'breakfast' | 'lunch' | 'dinner'.",
  schema: z.object({
    weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mealId: z.number().int(),
    day: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
    mealSlot: z.enum(["breakfast", "lunch", "dinner"]),
    servings: z.number().positive().default(2),
    cookStyle: CookStyleEnum.optional(),
  }),
  handler: async (input) => {
    // weekStartDate has no @unique constraint on WeeklyPlan, so use findFirst + create.
    const existing = await prisma.weeklyPlan.findFirst({
      where: { weekStartDate: new Date(input.weekStartDate) },
    });
    const plan =
      existing ??
      (await prisma.weeklyPlan.create({
        data: { weekStartDate: new Date(input.weekStartDate), status: "active" },
      }));
    const plannedMeal = await prisma.plannedMeal.create({
      data: {
        planId: plan.id,
        mealId: input.mealId,
        day: input.day,
        mealSlot: input.mealSlot,
        servings: input.servings,
        status: "planned",
        ...(input.cookStyle ? { cookStyle: input.cookStyle } : {}),
      },
    });
    return { plannedMeal };
  },
};

const markMealCooked: ToolDef = {
  name: "mark_meal_cooked",
  description:
    "Mark a planned meal cooked and deduct ingredients from the pantry. overrides[] lets you specify actual quantities used: [{ ingredientId, quantity, unit }]. Returns the updated plannedMeal and any shortfalls.",
  schema: z.object({
    plannedMealId: z.number().int(),
    overrides: z
      .array(
        z.object({
          ingredientId: z.number().int(),
          quantity: z.number().positive(),
          unit: z.string(),
        }),
      )
      .optional(),
  }),
  handler: async (input) => {
    return await prisma.$transaction(async (tx: any) => {
      const pm = await tx.plannedMeal.findUnique({
        where: { id: input.plannedMealId },
        include: { meal: true },
      });
      if (!pm) throw new Error(`PlannedMeal ${input.plannedMealId} not found`);
      if (pm.status === "cooked") {
        throw new Error(`PlannedMeal ${input.plannedMealId} is already cooked; deduction would be double-applied`);
      }
      // Mirror the cook-confirm route: multiplier is ratio of planned servings to meal's default servings.
      const multiplier = pm.servings / pm.meal.servings;
      const deduction = await deductIngredientsForMeal(pm.mealId, multiplier, input.overrides, tx);
      const plannedMeal = await tx.plannedMeal.update({
        where: { id: pm.id },
        data: { status: "cooked" },
      });
      return { plannedMeal, shortfalls: deduction.shortfalls };
    });
  },
};

export const planTools: ToolDef[] = [
  getPlannedWeek,
  addPlannedMeal,
  swapMeal,
  skipMeal,
  scaleServings,
  markMealCooked,
];
