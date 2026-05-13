import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { supersedeMeal, archiveMeal as svcArchiveMeal } from "../../services/mealService.js";
import type { ToolDef } from "../types.js";

const prisma = new PrismaClient();

const getMeals: ToolDef = {
  name: "get_meals",
  description:
    "List recipes from the library. Defaults to active default variants only. includeArchived/includeVariants expand the result.",
  schema: z.object({
    q: z.string().optional(),
    includeArchived: z.boolean().optional(),
    includeVariants: z.boolean().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  handler: async (input) => {
    const where: any = {};
    if (!input.includeArchived) where.archivedAt = null;
    if (!input.includeVariants) where.isDefault = true;
    if (input.q) where.name = { contains: input.q.toLowerCase() };
    const meals = await prisma.meal.findMany({
      where,
      take: input.limit ?? 50,
      orderBy: { name: "asc" },
      select: { id: true, name: true, tags: true, canBatch: true, canFresh: true, isDefault: true, recipeId: true },
    });
    return { meals };
  },
};

const getMealDetail: ToolDef = {
  name: "get_meal_detail",
  description: "Fetch a single recipe by id, optionally including the family of variants/versions.",
  schema: z.object({
    mealId: z.number().int(),
    withFamily: z.boolean().optional(),
  }),
  handler: async (input) => {
    const meal = await prisma.meal.findUnique({
      where: { id: input.mealId },
      include: { ingredients: { include: { ingredient: true } } },
    });
    if (!meal) return { meal: null };
    let family: any[] | undefined;
    if (input.withFamily) {
      family = await prisma.meal.findMany({
        where: { recipeId: meal.recipeId },
        select: { id: true, name: true, isDefault: true, archivedAt: true, parentMealId: true, versionNumber: true },
        orderBy: { id: "asc" },
      });
    }
    return { meal, family };
  },
};

const createVersionTool: ToolDef = {
  name: "create_recipe_version",
  description:
    "Create a new version of an existing recipe. The new meal becomes a child of the source (linked via parentMealId, with incremented versionNumber). Use this when the user wants to update or improve a recipe while keeping the prior version in history. Both versions share the same recipeId, so they appear together in the recipe family.",
  schema: z.object({
    sourceMealId: z.number().int(),
    name: z.string().optional(),
  }),
  handler: async (input) => {
    const meal = await supersedeMeal(input.sourceMealId, { name: input.name });
    return { meal };
  },
};

const archiveMealTool: ToolDef = {
  name: "archive_meal",
  description:
    "Archive a meal (hides it from default planning views). Use archive_meal, NOT archive_family — family-level archival is destructive and not exposed here.",
  schema: z.object({ mealId: z.number().int() }),
  handler: async (input) => {
    const meal = await svcArchiveMeal(input.mealId);
    return { meal };
  },
};

export const recipeTools: ToolDef[] = [getMeals, getMealDetail, createVersionTool, archiveMealTool];
