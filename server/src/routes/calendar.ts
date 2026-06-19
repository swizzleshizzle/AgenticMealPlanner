import { Router } from "express";
import * as calendarService from "../services/calendarService.js";
import * as plannerService from "../services/plannerService.js";
import { prisma } from "../lib/prisma.js";
import { parseId } from "./_validation.js";

const router = Router();

export const dayOffsets: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

router.get("/auth", (_req, res) => {
  const url = calendarService.getAuthUrl();
  res.redirect(url);
});

router.get("/callback", async (req, res) => {
  // Google redirects here with ?error=access_denied (no code) if the user
  // declines consent — validate before handing it to the OAuth client.
  const code = req.query.code;
  if (typeof code !== "string" || code.length === 0) {
    res.status(400).send("Calendar authorization failed or was denied. You can close this tab and try again.");
    return;
  }
  try {
    await calendarService.handleCallback(code);
    res.send("Calendar connected! You can close this tab.");
  } catch {
    res.status(502).send("Could not complete calendar authorization. You can close this tab and try again.");
  }
});

router.post("/sync/:planId", async (req, res) => {
  const planId = parseId(req.params.planId, res, "plan id");
  if (planId === null) return;
  const plan = await plannerService.getPlanById(planId);
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }

  const weekStart = new Date(plan.weekStartDate);

  const results = [];
  for (const pm of plan.plannedMeals) {
    const dayOffset = dayOffsets[pm.day] ?? 0;
    const mealDate = new Date(weekStart);
    // Stay in UTC end-to-end: weekStartDate is a UTC-midnight @db.Date, so
    // advancing with setUTCDate and reading back with toISOString keeps the
    // calendar date correct. Mixing local setDate with UTC toISOString rolled
    // events back a day for hosts west of UTC (code review H5).
    mealDate.setUTCDate(mealDate.getUTCDate() + dayOffset);
    const dateStr = mealDate.toISOString().split("T")[0];

    const prepNote = pm.cookStyle === "batch_prep" ? " [Meal Prep]"
                  : pm.cookStyle === "leftovers"  ? " [Leftovers]"
                  : "";
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
