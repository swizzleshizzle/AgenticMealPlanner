import { apiFetch } from "./client";
import type { Meal } from "./meals";

export interface PlannedMeal {
  id: number;
  mealId: number;
  day: string;
  mealSlot: string;
  servings: number;
  isPrep: boolean;
  status: string;
  meal: Meal;
}

export interface WeeklyPlan {
  id: number;
  weekStartDate: string;
  status: string;
  plannedMeals: PlannedMeal[];
}

export const getPlans = () => apiFetch<WeeklyPlan[]>("/plans");
export const getPlan = (id: number) => apiFetch<WeeklyPlan>(`/plans/${id}`);
export const createPlan = (weekStartDate: string) =>
  apiFetch<WeeklyPlan>("/plans", { method: "POST", body: JSON.stringify({ weekStartDate }) });
export const updatePlan = (id: number, data: any) =>
  apiFetch<WeeklyPlan>(`/plans/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const generatePlan = (id: number) =>
  apiFetch<WeeklyPlan>(`/plans/${id}/generate`, { method: "POST" });
export const addPlannedMeal = (planId: number, data: any) =>
  apiFetch<PlannedMeal>(`/plans/${planId}/meals`, { method: "POST", body: JSON.stringify(data) });
export const updatePlannedMeal = (planId: number, mealId: number, data: any) =>
  apiFetch<PlannedMeal>(`/plans/${planId}/meals/${mealId}`, { method: "PUT", body: JSON.stringify(data) });
export const removePlannedMeal = (planId: number, mealId: number) =>
  apiFetch<void>(`/plans/${planId}/meals/${mealId}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Plan / date helpers shared by the Planner and the AddToPlanModal.
// Kept here (not in a separate util module) so every consumer that already
// imports plan types gets the helpers for free.
// ---------------------------------------------------------------------------

export function localMidnightFromISO(s: string): Date {
  // Accepts both "YYYY-MM-DD" and full ISO ("YYYY-MM-DDTHH:mm:ss.sssZ"); always
  // returns local midnight on the calendar date — preserves the date the user
  // chose regardless of their timezone offset.
  return new Date(s.slice(0, 10) + "T00:00:00");
}

function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getNextMonday(): string {
  // Upcoming Monday on-or-after today, formatted YYYY-MM-DD in local time.
  // Called on a Monday → returns today.
  const now = new Date();
  const day = now.getDay();
  const diff = (8 - day) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return formatLocalDate(monday);
}

function planCoversToday(plan: WeeklyPlan): boolean {
  const start = localMidnightFromISO(plan.weekStartDate);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const now = Date.now();
  return now >= start.getTime() && now < end.getTime();
}

function planNotPast(plan: WeeklyPlan): boolean {
  const start = localMidnightFromISO(plan.weekStartDate);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end.getTime() > Date.now();
}

/**
 * Picks the most-relevant plan to surface to the user:
 *   1. a draft that covers today (user is about to finalize this week)
 *   2. any plan covering today (active/completed; still this week's data)
 *   3. the soonest non-past plan (upcoming)
 *   4. null (nothing useful)
 */
export function pickRelevantPlan(plans: WeeklyPlan[]): WeeklyPlan | null {
  const candidates = plans
    .filter(planNotPast)
    .sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate));
  const covering = candidates.filter(planCoversToday);
  return covering.find((pl) => pl.status === "draft")
      ?? covering[0]
      ?? candidates[0]
      ?? null;
}
