import { apiFetch } from "./client";

export interface Ingredient {
  id: number;
  name: string;
  category: string;
  defaultUnit: string;
}

export const getIngredients = () => apiFetch<Ingredient[]>("/ingredients");
export const createIngredient = (data: { name: string; category: string; defaultUnit: string }) =>
  apiFetch<Ingredient>("/ingredients", { method: "POST", body: JSON.stringify(data) });
