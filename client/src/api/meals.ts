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
  canBatch: boolean;
  canFresh: boolean;
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  tags: string[];
  instructions: string;
  imageUrl: string | null;
  pdfPath: string | null;
  imagePath: string | null;
  imageSource: "embedded" | "rasterized" | "manual" | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  recipeId: number;
  versionNumber: number;
  parentMealId: number | null;
  isDefault: boolean;
  archivedAt: string | null;
  variantCount?: number;
  updatedAt?: string;
  ingredients: MealIngredient[];
}

export interface ArchivedMealsResponse {
  archivedFamilies: Meal[];
  archivedVariants: Meal[];
}

export const getMeals = () => apiFetch<Meal[]>("/meals");
export const getMeal  = (id: number) => apiFetch<Meal>(`/meals/${id}`);

export const createMeal = (data: any) =>
  apiFetch<Meal>("/meals", { method: "POST", body: JSON.stringify(data) });
export const updateMeal = (id: number, data: any) =>
  apiFetch<Meal>(`/meals/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteMeal = (id: number) =>
  apiFetch<void>(`/meals/${id}`, { method: "DELETE" });

export const supersedeMeal = (id: number, data: any) =>
  apiFetch<Meal>(`/meals/${id}/version`, { method: "POST", body: JSON.stringify(data) });
export const createVariant = (id: number, data: any) =>
  apiFetch<Meal>(`/meals/${id}/variant`, { method: "POST", body: JSON.stringify(data) });

export const archiveMeal = (id: number) =>
  apiFetch<Meal>(`/meals/${id}/archive`, { method: "POST" });
export const archiveFamily = (id: number) =>
  apiFetch<{ recipeId: number; archivedCount: number }>(
    `/meals/${id}/archive-family`, { method: "POST" });
export const unarchiveMeal = (id: number) =>
  apiFetch<Meal>(`/meals/${id}/unarchive`, { method: "POST" });
export const setDefaultMeal = (id: number) =>
  apiFetch<Meal>(`/meals/${id}/set-default`, { method: "POST" });

export const getMealFamily = (id: number) => apiFetch<Meal[]>(`/meals/${id}/family`);
export const getArchivedMeals = () => apiFetch<ArchivedMealsResponse>(`/meals/archived`);

export const getIngredients = () => apiFetch<Ingredient[]>("/ingredients");

export interface ImportRecipeResult {
  parsed: any;
  ingredientMap: Record<string, number>;
  importSessionId: string;
}

export async function importRecipe(file: File): Promise<ImportRecipeResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/meals/import", { method: "POST", body: form });
  if (!res.ok) throw new Error("Import failed");
  return res.json();
}

export async function uploadMealPhoto(id: number, file: File): Promise<Meal> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/meals/${id}/photo`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "upload failed");
  return res.json();
}

export async function uploadMealPdf(id: number, file: File): Promise<Meal> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/meals/${id}/pdf`, { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "upload failed");
  return res.json();
}

export async function extractMealThumbnail(id: number, force = false): Promise<Meal> {
  const q = force ? "?force=true" : "";
  const res = await fetch(`/api/meals/${id}/extract-thumbnail${q}`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "extraction failed");
  return res.json();
}
