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
