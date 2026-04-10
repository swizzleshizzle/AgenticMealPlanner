import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import * as calendarService from "../services/calendarService.js";
import * as plannerService from "../services/plannerService.js";

const router = Router();
const prisma = new PrismaClient();

router.get("/auth", (_req, res) => {
  const url = calendarService.getAuthUrl();
  res.redirect(url);
});

router.get("/callback", async (req, res) => {
  const code = req.query.code as string;
  await calendarService.handleCallback(code);
  res.send("Calendar connected! You can close this tab.");
});

router.post("/sync/:planId", async (req, res) => {
  const plan = await plannerService.getPlanById(Number(req.params.planId));
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  const weekStart = new Date(plan.weekStartDate);
  const dayOffsets: Record<string, number> = {
    monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
    friday: 4, saturday: 5, sunday: 6,
  };

  const results = [];
  for (const pm of plan.plannedMeals) {
    const dayOffset = dayOffsets[pm.day] ?? 0;
    const mealDate = new Date(weekStart);
    mealDate.setDate(mealDate.getDate() + dayOffset);
    const dateStr = mealDate.toISOString().split("T")[0];

    const prepNote = pm.isPrep ? " [Meal Prep]" : "";
    const eventId = await calendarService.createMealEvent({
      summary: `${pm.meal.name}${prepNote}`,
      description: `${pm.servings} servings | ${pm.mealSlot}`,
      date: dateStr,
      mealSlot: pm.mealSlot,
    });

    await prisma.plannedMeal.update({
      where: { id: pm.id },
      data: { calendarEventId: eventId },
    });

    results.push({ plannedMealId: pm.id, eventId });
  }

  res.json({ synced: results.length, events: results });
});

export default router;
