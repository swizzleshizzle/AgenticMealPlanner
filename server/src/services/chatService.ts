import { PrismaClient } from "@prisma/client";
import { chat } from "../claude/chatAgent.js";
import type { ChatResponse } from "../claude/chatAgent.js";
import * as plannerService from "./plannerService.js";

const prisma = new PrismaClient();

function localYmd(d: Date): string {
  // Format a Date in the server's local timezone — for "now", not for DB dates.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dbDateYmd(d: Date): string {
  // Prisma @db.Date columns come back as midnight-UTC; the local-timezone
  // accessors would shift the day west of UTC. Slice the ISO string instead.
  return d.toISOString().slice(0, 10);
}

function thisWeekMonday(now: Date): string {
  const dayIndex = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayIndex);
  return localYmd(monday);
}

export async function handleChatMessage(message: string): Promise<ChatResponse & { applied: boolean[] }> {
  const meals = await prisma.meal.findMany({
    select: { id: true, name: true, tags: true, canBatch: true, canFresh: true },
  });
  const pantryItems = await prisma.pantryItem.findMany({
    include: { ingredient: true },
  });
  const pantry = pantryItems.map((p) => ({
    name: p.ingredient.name,
    quantity: p.quantity,
    unit: p.unit,
  }));

  const activePlan = await prisma.weeklyPlan.findFirst({
    where: { status: "active" },
    include: {
      plannedMeals: { include: { meal: true } },
    },
    orderBy: { weekStartDate: "desc" },
  });

  const currentPlan = activePlan
    ? {
        id: activePlan.id,
        weekStartDate: dbDateYmd(activePlan.weekStartDate),
        meals: activePlan.plannedMeals.map((pm) => ({
          id: pm.id,
          mealName: pm.meal.name,
          day: pm.day,
          mealSlot: pm.mealSlot,
          servings: pm.servings,
          status: pm.status,
        })),
      }
    : null;

  const now = new Date();
  const today = localYmd(now);
  const currentWeekStart = thisWeekMonday(now);

  const response = await chat(message, { meals, pantry, currentPlan, today, currentWeekStart });

  const applied: boolean[] = [];
  for (const action of response.actions) {
    try {
      switch (action.type) {
        case "swap_meal":
          await plannerService.updatePlannedMeal(action.params.plannedMealId, {
            mealId: action.params.newMealId,
          });
          applied.push(true);
          break;
        case "skip_meal":
          await plannerService.updatePlannedMeal(action.params.plannedMealId, {
            status: "skipped",
          });
          applied.push(true);
          break;
        case "scale_servings":
          await plannerService.updatePlannedMeal(action.params.plannedMealId, {
            servings: action.params.newServings,
          });
          applied.push(true);
          break;
        case "none":
          applied.push(true);
          break;
        default:
          applied.push(false);
      }
    } catch {
      applied.push(false);
    }
  }

  return { ...response, applied };
}
