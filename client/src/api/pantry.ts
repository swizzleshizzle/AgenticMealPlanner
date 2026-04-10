import { apiFetch } from "./client";
import type { Ingredient } from "./ingredients";

export interface PantryItem {
  id: number;
  ingredientId: number;
  quantity: number;
  unit: string;
  location: string;
  expirationDate: string | null;
  ingredient: Ingredient;
}

export const getPantry = () => apiFetch<PantryItem[]>("/pantry");
export const addPantryItem = (data: any) =>
  apiFetch<PantryItem>("/pantry", { method: "POST", body: JSON.stringify(data) });
export const updatePantryItem = (id: number, data: any) =>
  apiFetch<PantryItem>(`/pantry/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deletePantryItem = (id: number) =>
  apiFetch<void>(`/pantry/${id}`, { method: "DELETE" });
