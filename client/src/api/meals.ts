import { apiFetch } from "./client";

export interface Ingredient {
  id: number;
  name: string;
  category: string;
  defaultUnit: string;
}

export interface MealIngredient {
  id: number;
  quantity: number;
  unit: string;
  preparation: string | null;
  ingredient: Ingredient;
}

export interface Meal {
  id: number;
  name: string;
  description: string | null;
  source: string;
  mealType: string;
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  tags: string[];
  instructions: string;
  imageUrl: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  ingredients: MealIngredient[];
}

export const getMeals = () => apiFetch<Meal[]>("/meals");
export const getMeal = (id: number) => apiFetch<Meal>(`/meals/${id}`);
export const createMeal = (data: any) =>
  apiFetch<Meal>("/meals", { method: "POST", body: JSON.stringify(data) });
export const updateMeal = (id: number, data: any) =>
  apiFetch<Meal>(`/meals/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteMeal = (id: number) =>
  apiFetch<void>(`/meals/${id}`, { method: "DELETE" });

export async function importRecipe(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/meals/import", { method: "POST", body: form });
  if (!res.ok) throw new Error("Import failed");
  return res.json();
}
